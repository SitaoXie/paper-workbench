import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  ProxyAgent,
  EnvHttpProxyAgent,
  request as proxyRequest,
  fetch as undiciFetch,
} from "undici";

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function configuredProxy(url) {
  const bypass = (process.env.no_proxy || process.env.NO_PROXY || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const hostname = url.hostname.toLowerCase();
  if (
    bypass.some((rule) => {
      if (rule === "*") return true;
      const [host, port] = rule.replace(/^\./, "").split(":");
      return (
        (!port ||
          port === (url.port || (url.protocol === "https:" ? "443" : "80"))) &&
        (hostname === host || hostname.endsWith(`.${host}`))
      );
    })
  )
    return null;
  return url.protocol === "https:"
    ? process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY
    : process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY;
}

let modelProxyAgent;
export async function modelFetch(url, options) {
  if (configuredProxy(new URL(url))) {
    modelProxyAgent ||= new EnvHttpProxyAgent({
      httpProxy:
        process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY,
      httpsProxy:
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY,
    });
    return undiciFetch(url, { ...options, dispatcher: modelProxyAgent });
  }
  return fetch(url, options);
}

export async function publicLookup(
  hostname,
  options = {},
  fetchImpl = modelFetch,
) {
  if (!process.env.DNS_OVER_HTTPS_URL) return dns.lookup(hostname, options);
  let resolver;
  try {
    resolver = new URL(process.env.DNS_OVER_HTTPS_URL);
  } catch {
    throw new ApiError(
      "DNS_OVER_HTTPS_URL must be a valid HTTPS DNS JSON endpoint.",
      500,
    );
  }
  if (resolver.protocol !== "https:" || resolver.username || resolver.password)
    throw new ApiError(
      "DNS_OVER_HTTPS_URL must use HTTPS without URL credentials.",
      500,
    );
  // This resolver is operator-selected, like a network proxy. It is only used
  // when explicitly configured, so ordinary installs do not send DNS to a new service.
  const records = await Promise.all(
    [
      ["A", 1, 4],
      ["AAAA", 28, 6],
    ].map(async ([type, code, family]) => {
      const endpoint = new URL(resolver);
      endpoint.searchParams.set("name", hostname);
      endpoint.searchParams.set("type", type);
      const result = await fetchImpl(endpoint.href, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(9000),
        redirect: "error",
      });
      if (!result.ok)
        throw new ApiError(
          "The configured DNS-over-HTTPS resolver is unavailable.",
          502,
        );
      const data = await result.json();
      return (data.Answer || [])
        .filter(
          (answer) => answer.type === code && net.isIP(answer.data) === family,
        )
        .map((answer) => ({ address: answer.data, family }));
    }),
  );
  const addresses = records.flat();
  if (!addresses.length)
    throw new ApiError("The source hostname has no address records.", 502);
  return options.all ? addresses : addresses[0];
}

async function downloadThroughProxy(url, addresses, proxy, maxBytes, timeout) {
  // The proxy is explicitly configured by the operator. It may be local, but the
  // destination stays pinned to a validated public IP; TLS verifies the original hostname.
  const target = new URL(url);
  target.hostname =
    addresses[0].family === 6
      ? `[${addresses[0].address}]`
      : addresses[0].address;
  const agent = new ProxyAgent({
    uri: proxy,
    requestTls: { servername: url.hostname },
  });
  try {
    const result = await proxyRequest(target, {
      dispatcher: agent,
      method: "GET",
      headers: {
        host: url.host,
        "user-agent": "PaperWorkbench/0.1",
        accept:
          "application/pdf,application/atom+xml,text/html,text/plain;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
      },
      signal: AbortSignal.timeout(Math.max(1, timeout)),
      maxRedirections: 0,
    });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      result.body.destroy();
      return { redirect: result.headers.location };
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      result.body.destroy();
      throw new ApiError(`Source returned HTTP ${result.statusCode}.`, 502);
    }
    if (Number(result.headers["content-length"]) > maxBytes) {
      result.body.destroy();
      throw new ApiError("Remote file exceeds the download size limit.", 413);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of result.body) {
      size += chunk.length;
      if (size > maxBytes) {
        result.body.destroy();
        throw new ApiError("Remote file exceeds the download size limit.", 413);
      }
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: result.headers["content-type"] || "",
      url: url.href,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error.name === "TimeoutError" || error.name === "AbortError"
        ? "Download timed out."
        : "Unable to download through the configured network proxy.",
      502,
    );
  } finally {
    await agent.close();
  }
}

export function isPublicAddress(input) {
  let address = input.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv6(address))
    address = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (net.isIPv4(mapped)) return isPublicAddress(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2) {
      const number = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      return isPublicAddress(
        [
          number >>> 24,
          (number >>> 16) & 255,
          (number >>> 8) & 255,
          number & 255,
        ].join("."),
      );
    }
    return false;
  }
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIPv6(address)) {
    // Global unicast only; exclude documentation, transition and translation ranges.
    const second = parseInt(address.split(":")[1] || "0", 16);
    return (
      /^[23]/.test(address) &&
      !(address.startsWith("2001:") && (second <= 0x1ff || second === 0xdb8)) &&
      !address.startsWith("2002:") &&
      !address.startsWith("3fff:")
    );
  }
  return false;
}

export async function validatePublicUrl(input, lookup = publicLookup) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError("Enter a valid HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ApiError("Only HTTP(S) URLs without credentials are supported.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new ApiError("Private and local network URLs are blocked.");
  if (url.port && !["80", "443"].includes(url.port))
    throw new ApiError("Downloads are limited to public HTTP(S) ports.");
  let addresses;
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError("The URL hostname could not be resolved.", 502);
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new ApiError("Private and reserved network addresses are blocked.");
  return { url, addresses };
}

export async function secureDownload(
  input,
  {
    maxBytes = 25 * 1024 * 1024,
    timeout = 25000,
    redirects = 4,
    lookup = publicLookup,
    requestImpl,
  } = {},
) {
  let current = input;
  const deadline = Date.now() + timeout;
  for (let hop = 0; hop <= redirects; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ApiError("Download timed out.", 504);
    let dnsTimer;
    const { url, addresses } = await Promise.race([
      validatePublicUrl(current, lookup),
      new Promise((_, reject) => {
        dnsTimer = setTimeout(
          () => reject(new ApiError("DNS lookup timed out.", 504)),
          remaining,
        );
        dnsTimer.unref();
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    const proxy = requestImpl ? null : configuredProxy(url);
    const result = proxy
      ? await downloadThroughProxy(
          url,
          addresses,
          proxy,
          maxBytes,
          deadline - Date.now(),
        )
      : await new Promise((resolve, reject) => {
          const address = addresses[0];
          const request = (
            requestImpl || (url.protocol === "https:" ? https : http).get
          )(
            url,
            {
              headers: {
                "user-agent": "PaperWorkbench/0.1 (local research reader)",
                accept:
                  "application/pdf,application/atom+xml,text/html,text/plain;q=0.9,*/*;q=0.1",
                "accept-encoding": "identity",
              },
              // Pin the validated IP so a second DNS resolution cannot rebind to a private host.
              lookup: (_hostname, options, callback) =>
                options?.all
                  ? callback(null, [address])
                  : callback(null, address.address, address.family),
            },
            (response) => {
              if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                resolve({ redirect: response.headers.location });
                return;
              }
              if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(
                  new ApiError(
                    `Source returned HTTP ${response.statusCode}.`,
                    502,
                  ),
                );
                return;
              }
              if (Number(response.headers["content-length"]) > maxBytes) {
                response.destroy();
                reject(
                  new ApiError(
                    "Remote file exceeds the 25 MB download limit.",
                    413,
                  ),
                );
                return;
              }
              const chunks = [];
              let size = 0;
              response.on("data", (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                  response.destroy();
                  reject(
                    new ApiError(
                      "Remote file exceeds the download size limit.",
                      413,
                    ),
                  );
                } else chunks.push(chunk);
              });
              response.on("end", () =>
                resolve({
                  buffer: Buffer.concat(chunks),
                  contentType: response.headers["content-type"] || "",
                  url: url.href,
                }),
              );
              response.on("error", reject);
            },
          );
          const timer = setTimeout(
            () => request.destroy(new ApiError("Download timed out.", 504)),
            Math.max(1, deadline - Date.now()),
          );
          request.on("close", () => clearTimeout(timer));
          request.on("error", (error) =>
            reject(
              error instanceof ApiError
                ? error
                : new ApiError(
                    "Unable to download the source. Check its URL and network availability.",
                    502,
                  ),
            ),
          );
        });
    if ("redirect" in result) {
      if (!result.redirect)
        throw new ApiError("Source returned an invalid redirect.", 502);
      current = new URL(result.redirect, current).href;
    } else return result;
  }
  throw new ApiError("Source redirected too many times.", 502);
}

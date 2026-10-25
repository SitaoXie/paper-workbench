import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatProgressTail, chatMessageAnchor, nearChatBottom, readChatScroll, saveChatScroll, type ChatScrollPosition } from './chat-scroll';

type Message = { id?: string; role: string; content: string; reasoning?:{text:string}[]; streaming?:boolean };
type Binding = { node: HTMLDivElement; key: string; position: ChatScrollPosition; initialized: boolean; observer?: ResizeObserver };
const emptyPosition = (): ChatScrollPosition => ({ top: 0, following: true, unread: false, tail: '', count: 0, updatedAt: Date.now() });

/** Keep the reader's location independently of panel mounts and message arrival. */
export function useChatScroll(key: string, messages: Message[], busy: boolean) {
  const anchors = useMemo(() => messages.map(chatMessageAnchor), [messages]);
  const binding = useRef<Binding | null>(null);
  const latestAnchors = useRef(anchors);
  latestAnchors.current = anchors;
  const latestTail = useRef(''); latestTail.current = chatProgressTail(messages);
  const [status, setStatus] = useState({ key, unread: false, away: false });
  const publish = useCallback((current: Binding) => {
    const next = { key: current.key, unread: current.position.unread, away: !current.position.following };
    setStatus(old => old.key === next.key && old.unread === next.unread && old.away === next.away ? old : next);
  }, []);
  const save = useCallback((current: Binding) => {
    if (!current.initialized) return;
    const { node } = current;
    if (!node.isConnected || !node.clientHeight) return;
    const top = node.scrollTop, viewportTop = node.getBoundingClientRect().top;
    const rows = Array.from(node.querySelectorAll<HTMLElement>('[data-chat-anchor]'));
    const row = rows.find(item => item.getBoundingClientRect().bottom > viewportTop + 1);
    const rect = row?.getBoundingClientRect();
    current.position = { ...current.position, top,
      ...(row && rect ? { anchor: { key: row.dataset.chatAnchor!, fraction: Math.max(-1, Math.min(1, (viewportTop - rect.top) / Math.max(1, rect.height))) } } : { anchor: undefined }),
      updatedAt: Date.now() };
    saveChatScroll(current.key, current.position);
  }, []);
  const place = useCallback((current: Binding) => {
    if (!current.initialized || !current.node.isConnected) return;
    const { node, position } = current;
    let top = position.top;
    if (position.following) top = node.scrollHeight - node.clientHeight;
    else if (position.anchor) {
      const row = Array.from(node.querySelectorAll<HTMLElement>('[data-chat-anchor]')).find(item => item.dataset.chatAnchor === position.anchor!.key);
      if (row) {
        const rect = row.getBoundingClientRect();
        top = node.scrollTop + rect.top - node.getBoundingClientRect().top + position.anchor.fraction * rect.height;
      }
    }
    const target=Math.max(0, Math.min(top,node.scrollHeight-node.clientHeight));
    // Fractional scrollTop rounding must not generate an endless stream of
    // programmatic scroll events at the bottom edge.
    if(Math.abs(node.scrollTop-target)>1)node.scrollTop = target;
    save(current);
  }, [save]);
  const synchronize = useCallback((current: Binding) => {
    const nextAnchors = latestAnchors.current;
    const tail = latestTail.current, position = current.position;
    const changed = position.tail !== tail && nextAnchors.length >= position.count && !!position.count;
    if (changed && !position.following) position.unread = true;
    position.tail = tail; position.count = nextAnchors.length;
    current.initialized = true;
    place(current); publish(current);
    if (!current.observer) {
      current.observer = new ResizeObserver(() => { if (binding.current === current) place(current); });
      current.observer.observe(current.node);
    }
    // Recommendations can precede the messages. Observing only the first child
    // misses image/diagram loads and expanding reasoning in the actual transcript.
    current.observer.disconnect();
    current.observer.observe(current.node);
    for(const content of current.node.children)current.observer.observe(content);
  }, [place, publish]);
  const ref = useCallback((node: HTMLDivElement | null) => {
    const previous = binding.current;
    if (previous) { save(previous); previous.observer?.disconnect(); }
    const current = node ? { node, key, position: readChatScroll(key) || emptyPosition(), initialized: false } : null;
    binding.current = current;
    if (current) synchronize(current);
  }, [key, save, synchronize]);
  useLayoutEffect(() => {
    const current = binding.current;
    if (current && current.key === key) synchronize(current);
  }, [key, anchors, busy, synchronize]);
  const onScroll = useCallback(() => {
    const current = binding.current;
    if (!current?.initialized) return;
    current.position.following = nearChatBottom(current.node.scrollTop, current.node.scrollHeight, current.node.clientHeight);
    if (current.position.following) current.position.unread = false;
    save(current); publish(current);
  }, [save, publish]);
  const remember = useCallback(() => { if (binding.current) save(binding.current); }, [save]);
  const followLatest = useCallback((targetKey = key, focus = false) => {
    const current = binding.current;
    if (current?.key === targetKey) {
      current.position.following = true; current.position.unread = false;
      place(current); publish(current);
      if (focus) current.node.focus({ preventScroll: true });
    } else {
      const position = readChatScroll(targetKey) || emptyPosition();
      saveChatScroll(targetKey, { ...position, following: true, unread: false, updatedAt: Date.now() });
    }
  }, [key, place, publish]);
  return { ref, onScroll, remember, followLatest, anchors, unread: status.key === key && status.unread, away: status.key === key && status.away };
}

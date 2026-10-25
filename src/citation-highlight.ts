/** Highlight expiry belongs to a displayed navigation, not to text lookup time.
 * The revision guard also rejects an already queued callback after cancellation. */
export function citationHighlightLifetime(
  schedule:(work:()=>void,delay:number)=>ReturnType<typeof setTimeout> = setTimeout,
  cancel:(timer:ReturnType<typeof setTimeout>)=>void = clearTimeout,
) {
  let key:string|undefined,timer:ReturnType<typeof setTimeout>|undefined,revision=0;
  const pause=()=>{revision++;if(timer!==undefined)cancel(timer);timer=undefined;};
  return {
    begin(next:string){pause();key=next;},
    pause,
    shown(next:string,expire:()=>void){if(key!==next)return;pause();const version=revision;timer=schedule(()=>{if(version===revision&&key===next){timer=undefined;expire();}},6000);},
    dispose(){pause();key=undefined;},
  };
}

/** A previous zoom's text layer can still exist before React runs its cleanup. */
export function readyPdfTextLayer(surface:HTMLElement|null,scale:number):HTMLElement|null {
  const layer=surface?.querySelector<HTMLElement>(".pdf-text-layer[data-rendered='true']");
  return layer&&Number(layer.dataset.renderScale)===scale?layer:null;
}

import { useEffect, useState } from 'react';
import { t } from './i18n';
import type { Message } from './types';
import './chat-stream.css';
export default function ReasoningPanel({message}:{message:Message}) {
  const running=!!message.streaming;
  const [open,setOpen]=useState(running);
  useEffect(()=>{setOpen(running);},[running]);
  if(!message.reasoning?.length)return null;
  return <details className="reasoning-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{running?t('思考中','Thinking'):message.streamError?t('思考已中断','Thinking interrupted'):t('思考已完成','Thinking complete')}<span>{open?t('收起','Collapse'):t('展开','Expand')}</span></summary>
    <div className="reasoning-content"><small>{t('模型接口返回的思考内容','Thinking text returned by the model API')}</small>{message.reasoning.map(part=><section key={part.round}>{message.reasoning!.length>1&&<b>{t(`第 ${part.round} 轮`,`Round ${part.round}`)}</b>}<p>{part.text}</p></section>)}{message.reasoningTruncated&&<p>{t('内容过长，仅保留前部分。','Only the beginning is retained because this content is very long.')}</p>}</div>
  </details>;
}

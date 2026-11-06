import { Router } from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const DEMO_PAPER_ID = 'demo-evidence-paper';
const date = '2026-01-01T00:00:00.000Z';
const quote = 'Reranking raises recall from 0.62 to 0.78, while latency rises from 24 to 39 ms.';
const source = {kind:'agent',agent:'Paper Workbench · prewritten example'};
const citation = `[结果与代价](#page=2 "${quote}")`;
const citationEn = `[Results and cost](#page=2 "${quote}")`;
const quick = `## 一句话理解\n多一步重排可能找回更多相关资料，但也更慢。本示例展示如何把结论、证据和自己的判断放在一起。\n\n> 这是一篇为演示制作的虚构论文，数字仅用于展示界面，不是研究结论。所有解读和问答均为预写内容，不调用模型。\n\n## 先看这个权衡\n召回率从 **0.62** 提高至 **0.78**，延迟从 **24 ms** 增至 **39 ms**。先判断你的任务更在意遗漏还是等待，再决定是否需要重排。${citation}\n\n:::figure demo-results\n\n## 带着问题回到原文\n这个结果是否适用于长文档？作者只构造了一个很小的示例，没有重复试验或不确定性估计，因此不能据此判断真实系统效果。[实验边界](#page=3 "These illustrative values do not establish a real-world performance advantage.")`;
const quickEn = `## The idea in one sentence\nReranking can retrieve more relevant material, at the cost of extra latency. This sample connects a claim to its evidence and your own judgment.\n\n> This is a fictional demonstration paper. Values are illustrative, not research findings. Readings and answers are prewritten; no model is called.\n\n## Start with the trade-off\nRecall rises from **0.62** to **0.78**, while latency increases from **24 ms** to **39 ms**. Decide whether missing evidence or waiting matters more for your task. ${citationEn}\n\n:::figure demo-results\n\n## Return to the evidence\nDoes this apply to long documents? This tiny example has no repeated runs or uncertainty estimates, so it cannot establish real system performance. [Limitations](#page=3 "These illustrative values do not establish a real-world performance advantage.")`;
const deep = `${quick}\n\n## 怎么读这个实验\n### 1. 分清系统改动与评估指标\n基线用关键词挑选候选文档；另一个方案对候选项重新排序。召回率反映找回相关文档的比例，延迟反映等待时间。不要把两个指标混成一个“更好”的分数。[方法](#page=1 "The reranker reorders the same candidate documents before returning results.")\n\n### 2. 检查收益是否值得代价\n| 方案 | 召回率 | 延迟 |\n| :--- | ---: | ---: |\n| 关键词基线 | 0.62 | 24 ms |\n| 加入重排 | 0.78 | 39 ms |\n\n这是 **0.16** 的绝对召回增幅，对应 **15 ms** 的额外等待。没有置信区间，不能判断差异是否稳定。${citation}\n\n### 3. 复现前还缺什么\n需要真实数据划分、相关性标注准则、硬件与并发设置，以及重复运行结果。将这些缺口写进笔记，比只记住一个分数更有用。\n\n## 阅读行动\n点击“结果与代价”核对原句，然后打开笔记查看待验证的问题。真实论文可以用自己的模型继续追问；这里展示的是固定示例。`;
const deepEn = `${quickEn}\n\n## How to read this experiment\n### 1. Separate the intervention from its metrics\nThe baseline selects candidate documents by keywords. The second pipeline reranks those same candidates. Recall measures recovered relevant documents; latency measures waiting time. Neither alone defines a better system. [Method](#page=1 "The reranker reorders the same candidate documents before returning results.")\n\n### 2. Weigh the gain against the cost\n| Method | Recall | Latency |\n| :--- | ---: | ---: |\n| Keyword baseline | 0.62 | 24 ms |\n| With reranking | 0.78 | 39 ms |\n\nAn absolute recall gain of **0.16** costs **15 ms**. Without uncertainty estimates, we cannot tell how stable the difference is. ${citationEn}\n\n### 3. What reproduction would require\nAsk for real data splits, relevance labeling rules, hardware and concurrency settings, and repeated runs. Recording these gaps is more useful than remembering a single score.\n\n## Try it\nFollow Results and cost to verify the sentence, then open Notes to see a question worth checking. With a real paper you can ask your own model; this workspace shows fixed examples.`;

async function samplePdf() {
  const pdf=await PDFDocument.create();
  pdf.setTitle('Reading an Experiment: A Tiny Retrieval Study (fictional demo)');
  pdf.setAuthor('Paper Workbench Examples');
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages=[];
  const drawPage=(title,lines)=>{
    const page=pdf.addPage([612,792]);let y=690;
    page.drawText('PAPER WORKBENCH / READING LAB',{x:50,y:744,size:10,font:bold,color:rgb(.58,.23,.30)});
    page.drawText(title,{x:50,y,size:19,font:bold});y-=44;
    for(const line of lines){page.drawText(line,{x:50,y,size:11,font:regular});y-=22;}
    page.drawText('Fictional demonstration. All values are illustrative.',{x:50,y:38,size:9,font:regular,color:rgb(.45,.45,.45)});
    page.drawText(String(pages.length+1),{x:552,y:38,size:10,font:regular});
    pages.push({number:pages.length+1,text:[title,...lines].join('\n')});return page;
  };
  drawPage('Reading an Experiment: A Tiny Retrieval Study',[
    'Paper Workbench Examples | Learning resources', '', 'Abstract',
    'This fictional study illustrates how to read a retrieval experiment.',
    'We compare a keyword baseline with a second-stage reranker.',
    'The example connects a measurable benefit to its computational cost.', '', '1. Method',
    'Both pipelines start from the same set of candidate documents.',
    'The reranker reorders the same candidate documents before returning results.',
    'Recall measures the fraction of relevant documents retrieved.',
    'Latency measures the elapsed time before results are returned.', '', 'Reading questions',
    'Which metric matters most for your application?',
    'What evidence would be needed before deploying this system?',
  ]);
  const p=drawPage('2. Results: quality has a cost',[
    'Reranking raises recall from 0.62 to 0.78, while latency rises from 24 to 39 ms.',
    'The recall difference is 0.16; the additional latency is 15 ms.',
    'No confidence intervals or repeated measurements are provided.',
  ]);
  p.drawText('Figure 1. Illustrative recall comparison',{x:62,y:535,size:13,font:bold});
  for(const [i,label,value] of [[0,'Keyword baseline',.62],[1,'With reranking',.78]]){
    const y=460-i*78;p.drawText(label,{x:64,y:y+22,size:12,font:regular});
    p.drawRectangle({x:64,y,width:440*value,height:15,color:i?rgb(.58,.23,.30):rgb(.55,.67,.67)});
    p.drawText(value.toFixed(2),{x:80+440*value,y:y+2,size:12,font:bold});
  }
  p.drawText('Recall (0 to 1). Synthetic data; not a measured benchmark.',{x:64,y:340,size:10,font:regular});
  p.drawText('Table 1. Cost of the two example pipelines',{x:64,y:270,size:13,font:bold});
  p.drawText('Method                         Recall                  Latency',{x:64,y:240,size:12,font:bold});
  p.drawText('Keyword baseline             0.62                    24 ms',{x:64,y:215,size:12,font:regular});
  p.drawText('With reranking                  0.78                    39 ms',{x:64,y:190,size:12,font:regular});
  drawPage('3. Limitations and next steps',[
    'These illustrative values do not establish a real-world performance advantage.',
    'The sample does not specify a dataset, hardware, or uncertainty estimates.',
    'It cannot establish statistical significance or generalization.', '', 'Before reproduction',
    'Specify the dataset and train/test split.',
    'Document relevance judgments and the candidate generation procedure.',
    'Report hardware, concurrency, and repeated measurements.', '', 'A useful reading note',
    'Would the recall gain remain under a strict latency budget?',
    'Compare systems at the same latency, not only at the same candidate count.',
  ]);
  return {bytes:Buffer.from(await pdf.save()),pages};
}

/** Entirely synthetic and read-only. Never receives the user's store or any model client. */
export async function registerDemoWorkspace(app) {
  const {bytes,pages}=await samplePdf();
  const figure={id:'demo-results',page:2,label:'Figure 1',caption:'Figure 1. Illustrative recall comparison. Synthetic data, not a benchmark.',crop:{x:.08,y:.30,width:.84,height:.30}};
  const versions=[['quick',quick,quickEn],['deep',deep,deepEn]].map(([style,markdown,en])=>({
    id:`demo-${style}`,style,format:'article',title:style==='quick'?'Quick overview':'Deep reading',markdown,language:'zh-CN',createdAt:date,mode:'agent',coverage:'complete',source,
    translations:{en:{markdown:en,language:'en',createdAt:date,source,figureCaptions:{'demo-results':figure.caption}},'zh-CN':{markdown,language:'zh-CN',createdAt:date,source,figureCaptions:{'demo-results':'图 1：召回率对比。虚构示例数据，不代表真实基准结果。'}}},
  }));
  const paper={id:DEMO_PAPER_ID,title:'Reading an Experiment: A Tiny Retrieval Study',authors:['Paper Workbench Examples'],institutions:['Learning resources · fictional example'],abstract:'A fictional study for learning how to connect research claims to original evidence. Compare an illustrative retrieval baseline and reranker, inspect the recall–latency trade-off, and record what remains unverified.',translations:{'zh-CN':{abstract:{markdown:'这是一篇虚构的阅读练习论文，用来展示如何把结论与原文证据联系起来。比较关键词检索基线与重排方案，检查召回率和延迟的权衡，并记录尚待验证的问题。',language:'zh-CN',source}}},source:'pdf',createdAt:date,tags:['Demo','Evidence reading'],favorite:true,hasPdf:true,localPdfUrl:`/api/demo/papers/${DEMO_PAPER_ID}/file`,pageCount:3,pages,text:pages.map(p=>p.text).join('\n\n'),figures:[figure],readingVersions:versions,activeReadingId:'demo-deep'};
  const annotations=[{id:'demo-note',paperId:DEMO_PAPER_ID,kind:'note',page:2,quote,body:'待验证 / To verify: 在相同延迟预算下比较召回率。Compare recall at the same latency budget.',color:'yellow',rects:[{x:.08,y:.17,width:.84,height:.025}],tags:['To verify'],createdAt:date,updatedAt:date}];
  const messages=[{id:'demo-question',paperId:DEMO_PAPER_ID,conversationId:'demo-conversation',role:'user',content:'这个实验的核心权衡是什么？ / What is the main trade-off?'},{id:'demo-answer',paperId:DEMO_PAPER_ID,conversationId:'demo-conversation',role:'assistant',mode:'agent',source,content:`**预写示例 · Prewritten example · No model call**\n\n重排找回更多相关文档，但要多等一会儿：召回率增加 0.16，延迟增加 15 ms。${citation}\n\nReranking trades extra latency for higher recall. These fictional numbers illustrate a trade-off; they do not establish a real-world improvement. ${citationEn}\n\n值得继续问：**在相同延迟预算下，哪个方案更好？**\n\nA useful next question: **Which method works better at the same latency budget?**`}];
  const router=Router();
  router.use((req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD')return res.status(409).json({code:'DEMO_READ_ONLY',error:'示例为只读预写内容，不调用模型。返回个人工作区以导入、编辑或生成。 / This sample is read-only and makes no model calls. Return to your workspace to edit or generate.'});next();});
  router.get('/health',(_req,res)=>res.json({ok:true,modelConfigured:false,paperCount:1,demo:true}));
  router.get('/settings',(_req,res)=>res.json({provider:'openai',baseUrl:'',model:'',apiKeyConfigured:false,modelConfigured:false,profiles:[],assistant:{styleId:'balanced',pdfMode:'text',customStyles:[]},recommendations:{enabled:false},vision:{enabled:false}}));
  router.get('/papers',(_req,res)=>res.json({papers:[paper]}));
  router.get(`/papers/${DEMO_PAPER_ID}`,(_req,res)=>res.json({paper}));
  router.get(`/papers/${DEMO_PAPER_ID}/file`,(_req,res)=>res.type('application/pdf').send(bytes));
  router.get(`/papers/${DEMO_PAPER_ID}/annotations`,(_req,res)=>res.json({annotations}));
  router.get(`/papers/${DEMO_PAPER_ID}/activities`,(_req,res)=>res.json({activities:[]}));
  router.get(`/papers/${DEMO_PAPER_ID}/recommendations`,(_req,res)=>res.json({enabled:false,questions:[]}));
  router.get('/collections',(_req,res)=>res.json({collections:[{id:'demo-folder',name:'Reading lab · 阅读练习',kind:'custom',parentId:null,paperIds:[DEMO_PAPER_ID],createdAt:date,updatedAt:date}]}));
  router.get('/chats',(req,res)=>res.json({messages:req.query.paperId===DEMO_PAPER_ID?messages:[],conversationId:req.query.paperId===DEMO_PAPER_ID?'demo-conversation':null}));
  router.get('/conversations',(req,res)=>res.json({conversations:req.query.paperId===DEMO_PAPER_ID?[{id:'demo-conversation',paperId:DEMO_PAPER_ID,title:'Reading a trade-off · 阅读实验权衡',kind:'question',createdAt:date,updatedAt:date,messageCount:2}]:[],activeConversationId:req.query.paperId===DEMO_PAPER_ID?'demo-conversation':null}));
  router.use((_req,res)=>res.status(404).json({error:'This action is not available in the offline sample. / 离线示例不提供此操作。'}));
  app.use('/api/demo',router);
}

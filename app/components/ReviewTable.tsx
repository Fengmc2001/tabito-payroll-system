'use client';
import {CSSProperties, Fragment, useEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronUp} from 'lucide-react';
import {RecordHistoryItem, ReviewSalaryItem, SalaryRecord, STATUS, formatJapanDateTime, getDepartmentLabel} from '../lib/payroll';
import {employeeName, reviewPage} from '../lib/review-table';
import {apiRequest} from '../lib/api-client';
import {Money} from './payroll-ui';
import {RecordDetailsButton, RecordHistoryContent} from './RecordDetailsButton';
import {ReviewAssignment} from './ReviewAssignment';
import {VoidSalaryButton} from './VoidSalaryButton';

export function ReviewTable({items,administrator,locked,busyId,onApprove,onReject,onRefresh}:{
  items:ReviewSalaryItem[]; administrator:boolean; locked:boolean; busyId:string;
  onApprove:(item:ReviewSalaryItem)=>void; onReject:(item:ReviewSalaryItem)=>void; onRefresh:()=>Promise<void>;
}) {
  const [requestedPage,setPage]=useState(1);
  const {page,pages,items:pageItems}=reviewPage(items,requestedPage);
  const [expansion,setExpansion]=useState<{page:number;ids:string[]}>({page:1,ids:[]});
  const expanded=expansion.page===page ? expansion.ids : [];
  const allExpanded=pageItems.length>0 && pageItems.every(item=>expanded.includes(item.record.id));
  const wrap=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState<number>();
  useEffect(()=>{
    const element=wrap.current;
    if(!element)return;
    const observer=new ResizeObserver(()=>setWidth(element.clientWidth));
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  const toggle=(id:string)=>setExpansion({page,ids:expanded.includes(id)?expanded.filter(value=>value!==id):[...expanded,id]});
  const changePage=(next:number)=>{setPage(next);setExpansion({page:next,ids:[]});};
  return <div className="review-table-view">
    <div className="review-table-toolbar">
      <p>共 {items.length} 条 <span>· 第 {page} / {pages} 页</span></p>
      <button type="button" className="secondary-button" disabled={locked||!pageItems.length} onClick={()=>setExpansion({page,ids:allExpanded?[]:pageItems.map(item=>item.record.id)})}>{allExpanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>} {allExpanded?'收起全部详情':'展开全部详情'}</button>
    </div>
    <div ref={wrap} className="review-table-scroll" role="region" aria-label="工资审批横向表格" tabIndex={0} style={width?{'--review-viewport-width':`${width}px`} as CSSProperties:undefined}>
      <table className="review-table">
        <caption className="sr-only">当前筛选结果的工资审批记录，操作列固定在右侧</caption>
        <colgroup>{[120,160,90,112,190,104,120,170,155,112].map((value,index)=><col key={index} style={{width:value}}/>)}<col className="review-operation-col"/></colgroup>
        <thead><tr>{['员工姓名','申报金额与币种','状态','工作日期','工作内容摘要','部门','工作负责人','指定审核员','提交时间','详情'].map(label=><th key={label} scope="col">{label}</th>)}<th scope="col" className="review-table-operation">操作</th></tr></thead>
        <tbody>{pageItems.map(item=>{
          const r=item.record;
          const status=STATUS[r.status];
          const open=expanded.includes(r.id);
          const name=employeeName(item);
          return <Fragment key={r.id}>
            <tr className={`review-table-row review-table-row--${status.tone}`} data-record-id={r.id}>
              <th scope="row"><span className="review-cell-truncate" title={name}>{name}</span></th>
              <td className="review-table-amount"><Money amount={r.finalSalary} currency={r.currency}/></td>
              <td><span className={`status-badge status-badge--${status.tone}`}>{status.label}</span></td>
              <td><time dateTime={r.workDate}>{r.workDate}</time></td>
              <td><span className="review-cell-truncate" title={r.workContent}>{r.workContent || '—'}</span></td>
              <td><span className="review-cell-truncate">{getDepartmentLabel(r.departmentKey,r.departmentLabel)}</span></td>
              <td><span className="review-cell-truncate">{r.checkUser || '—'}</span></td>
              <td><span className="review-cell-summary" title={r.reviewerName || '未指定审核员，由管理员处理'}>{r.reviewerName || '未指定审核员，由管理员处理'}{r.reviewerUserId && r.reviewerAvailable===false && <small>权限失效，由管理员处理</small>}</span></td>
              <td>{item.submittedAt?<time dateTime={item.submittedAt}>{formatJapanDateTime(item.submittedAt)}</time>:<span title="旧记录未保存提交时间">—</span>}</td>
              <td className="review-table-details"><button type="button" aria-expanded={open} aria-controls={`review-detail-${r.id}`} onClick={()=>toggle(r.id)}>{open?'收起详情':'展开详情'}</button><RecordDetailsButton record={r} label="弹窗查看"/></td>
              <td className="review-table-operation">
                {r.status===2?<div className="review-fixed-actions"><button type="button" className="review-approve" disabled={locked} aria-label={`通过 ${name} ${r.workDate}`} onClick={()=>onApprove(item)}>{busyId===r.id?'处理中':'通过'}</button><button type="button" className="review-reject" disabled={locked} aria-label={`驳回 ${name} ${r.workDate}`} onClick={()=>onReject(item)}>驳回</button></div>:<span className="review-operation-done">{status.label}</span>}
              </td>
            </tr>
            {open && <tr className="review-table-detail-row"><td colSpan={11}>
              <section id={`review-detail-${r.id}`} className="review-inline-panel" aria-label={`${name} ${r.workDate} 工资详情`}>
                <header className="review-inline-identity"><div><strong>{name}</strong><time dateTime={r.workDate}>{r.workDate}</time><Money amount={r.finalSalary} currency={r.currency}/></div><button type="button" aria-label={`收起 ${name} ${r.workDate} 详情`} onClick={()=>toggle(r.id)}><ChevronUp size={16}/> 收起</button></header>
                <InlineHistory key={`${r.id}:${r.updatedAt}`} id={r.id}/>
                {administrator && (r.status===2 || r.status===3) && <div className="row-actions review-inline-tools">{r.status===2 && <ReviewAssignment record={r} onSaved={onRefresh}/>} {r.status===3 && <VoidSalaryButton record={r} onSaved={onRefresh}/>}</div>}
              </section>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <nav className="review-table-pagination" aria-label="工资审批分页"><span>每页 20 条</span><button type="button" className="secondary-button" disabled={locked||page<=1} onClick={()=>changePage(page-1)}>上一页</button><span aria-live="polite">{page} / {pages}</span><button type="button" className="secondary-button" disabled={locked||page>=pages} onClick={()=>changePage(page+1)}>下一页</button></nav>
  </div>;
}

function InlineHistory({id}:{id:string}) {
  const [result,setResult]=useState<{record:SalaryRecord;history:RecordHistoryItem[]}|null>(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    void apiRequest<{record:SalaryRecord;history:RecordHistoryItem[]}>(`/api/salary-records/${id}/history`)
      .then(data=>{if(active)setResult(data);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'加载失败，请重试。');});
    return ()=>{active=false;};
  },[id,retry]);
  if(error)return <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={()=>{setError('');setResult(null);setRetry(value=>value+1);}}>重试</button></div>;
  return result?<RecordHistoryContent result={result}/>:<p className="muted-text" role="status">正在加载明细和审批记录…</p>;
}

import assert from 'node:assert/strict';
import {reviewPage, rejectionReasonError, employeeName} from '../app/lib/review-table.ts';
import {readFileSync} from 'node:fs';
let checks=0;
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
for(const count of [0,1,19,20,21,39,40,41,201]) {
  const rows=Array.from({length:count},(_,id)=>({record:{id:String(id)},user:{displayName:'老师',email:'qa@example.invalid'}}));
  const seen=[];
  for(let i=1;i<=Math.max(1,Math.ceil(count/20));i++){
    const data=reviewPage(rows,i);equal(data.page,i,'requested page');
    equal(data.items.length<=20,true,'at most 20 details in expand all');seen.push(...data.items);
  }
  equal(seen,rows,'pages partition the visible list without crossing scope');
  equal(reviewPage(rows,999).page,Math.max(1,Math.ceil(count/20)),'clamp after approval removes a row');
  equal(reviewPage(rows,0).page,1,'first page lower bound');
}
for(const reason of ['',' ','\n\t','　'])equal(rejectionReasonError(reason),'请填写驳回理由。','blank rejection');
equal(rejectionReasonError('a'.repeat(1000)),'','max accepted');
equal(Boolean(rejectionReasonError('a'.repeat(1001))),true,'over limit refused');
equal(rejectionReasonError('  核对课时  '),'','reason trimmed');
equal(employeeName({user:{displayName:'老师A',email:'qa@example.invalid'}}),'老师A','prefer name');
equal(employeeName({user:{displayName:' ',email:'qa@example.invalid'}}),'qa@example.invalid','fallback to email');
const source=readFileSync('app/components/ReviewWorkspace.tsx','utf8');
const table=readFileSync('app/components/ReviewTable.tsx','utf8');
const dialog=readFileSync('app/components/ReviewRejectDialog.tsx','utf8');
equal(source.includes('submitting.current = true'),true,'synchronous duplicate guard');
equal(source.includes('expectedUpdatedAt: item.record.updatedAt'),true,'preserve captured version');
equal(source.includes('key={`${selectedUserId}:${month}:${filter}:${needsAssignment}`}'),true,'filter changes remount expansion/page state');
equal(table.includes('setExpansion({page:next,ids:[]})'),true,'page change collapses');
equal(table.includes('pageItems.map(item=>item.record.id)'),true,'expand only current page');
equal(table.includes('r.status===2?<div className="review-fixed-actions">'),true,'processed rows have no decision buttons');
equal(dialog.includes('onConfirm(reason.trim())'),true,'trim rejection reason');
equal(dialog.includes('sending.current=true'),true,'dialog double click guard');
const salary=readFileSync('app/components/SalaryWorkspace.tsx','utf8');
const assignment=readFileSync('app/components/ReviewAssignment.tsx','utf8');
const css=readFileSync('app/globals.css','utf8');
const travel=readFileSync('app/components/PayrollInputs.tsx','utf8');
equal(salary.includes('ReviewAssignment'),false,'do not add transfer to salary declaration');
equal(table.includes('<RecordDetailsButton'),false,'review table has no duplicate detail modal');
equal(table.includes('<InlineHistory'),true,'review table preserves inline history');
equal(table.includes('aria-label="管理员操作"'),true,'admin transfer is clearly grouped');
equal(table.includes('administrator && (r.status===2 || r.status===3)'),true,'transfer tools remain admin-only');
equal(assignment.includes('expectedUpdatedAt:record.updatedAt'),true,'transfer preserves version checking');
equal(css.includes('width: max-content; padding-inline-start: 100%; animation: payroll-reminder-scroll'),true,'reminder starts beyond full parent width');
equal(travel.includes('remembered.current ?? previous ??'),true,'manual travel changes take priority over submitted defaults');
equal(travel.includes('disabled={loading} aria-busy={loading}'),true,'travel cannot be enabled before defaults finish loading');
console.log(JSON.stringify({result:'PASS',checks}));

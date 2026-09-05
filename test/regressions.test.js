const test=require('node:test'),assert=require('node:assert/strict'),p=require('../server/domain/invoicePolicy');
test('receipt quantity is consumed across split invoice lines',()=>{
 const result=p.threeWayMatch({invoice:{vendorId:'v',lines:[{poLineId:'1',quantity:2,unitPrice:10},{poLineId:'1',quantity:2,unitPrice:10}]},purchaseOrder:{vendorId:'v',lines:[{lineId:'1',unitPrice:10}]},receipt:{lines:[{poLineId:'1',quantity:2}]}});
 assert.equal(result.matched,false);assert.ok(result.exceptions.some(e=>e.code==='QUANTITY_OVER_RECEIPT'));
});
test('missing quantity cannot pass numeric comparisons',()=>assert.equal(p.threeWayMatch({invoice:{vendorId:'v',lines:[{poLineId:'1',unitPrice:10}]},purchaseOrder:{vendorId:'v',lines:[{lineId:'1',unitPrice:10}]},receipt:{lines:[{poLineId:'1',quantity:1}]}}).matched,false));
test('UUID submitters cannot approve their own invoice',()=>assert.equal(p.authorizeTransition({current:'approval_pending',next:'approved',actor:{id:'user-a',role:'approver'},submitterId:'user-a',amount:1,approvals:[{actorId:'user-b',decision:'approve'}]}).ok,false));
test('numeric and string forms of the same reviewer count once',()=>assert.equal(p.authorizeTransition({current:'approval_pending',next:'approved',actor:{id:2,role:'approver'},submitterId:1,amount:20000,approvals:[{actorId:2,decision:'approve'},{actorId:'2',decision:'approve'}]}).ok,false));
test('calendar dates and explicit amounts are validated',()=>{
 const v={vendorId:'v',invoiceNumber:'i',invoiceDate:'2026-02-30',currency:'USD',lines:[{description:'x',quantity:1,unitPrice:0,net:0}],subtotal:0,tax:0,total:null};assert.equal(p.validateExtraction(v).ok,false);
});

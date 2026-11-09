(function(root){'use strict';
function build(data,ratio){if(!ratio||!data)return null;const result=ratio.calculate(data),euro=n=>n.toLocaleString('it-IT',{style:'currency',currency:'EUR'});return {ratio:result.ratio==null?'Non calcolabile':result.ratio.toFixed(1).replace('.',',')+'%',income:euro(result.income),commitments:euro(result.commitments),mortgage:euro(result.mortgage),residual:euro(result.residual),limits:[33,40,45,50].map(p=>({percent:p,value:result.income>0?euro(Math.max(0,result.income*p/100-result.commitments)):'Non calcolabile'}))};}
root.CredipassRatioPdf={build};if(typeof module!=='undefined')module.exports=root.CredipassRatioPdf;
})(typeof window==='undefined'?globalThis:window);

(function(root){
  function iso(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function week(now=new Date(),offset=0){const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);start.setDate(start.getDate()-(start.getDay()+6)%7+offset*7);const end=new Date(start);end.setDate(end.getDate()+6);return {periodStart:iso(start),periodEnd:iso(end)};}
  function month(now=new Date(),offset=0){const start=new Date(now.getFullYear(),now.getMonth()+offset,1,12),end=new Date(now.getFullYear(),now.getMonth()+offset+1,0,12);return {periodStart:iso(start),periodEnd:iso(end)};}
  const api={week,month};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CredipassDateFilters=api;
})(typeof window!=='undefined'?window:globalThis);

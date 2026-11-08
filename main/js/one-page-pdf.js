(function(root){'use strict';
function fit(width,height,pageWidth,pageHeight){if(!(width>0&&height>0&&pageWidth>0&&pageHeight>0))throw new Error('Dimensioni della scheda non valide.');const scale=Math.min(pageWidth/width,pageHeight/height),w=width*scale,h=height*scale;return {x:(pageWidth-w)/2,y:0,width:w,height:h};}
function fromCanvas(canvas,JsPDF){if(!canvas||typeof JsPDF!=='function')throw new Error('Generazione PDF non disponibile.');const pdf=new JsPDF({unit:'pt',format:'a4',orientation:'portrait'});const size=pdf.internal.pageSize,box=fit(canvas.width,canvas.height,size.getWidth(),size.getHeight());pdf.addImage(canvas,'JPEG',box.x,box.y,box.width,box.height,undefined,'FAST');return pdf;}
root.CredipassOnePagePDF={fit,fromCanvas};if(typeof module!=='undefined')module.exports=root.CredipassOnePagePDF;
})(typeof window==='undefined'?globalThis:window);

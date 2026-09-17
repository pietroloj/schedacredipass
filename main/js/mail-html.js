/* Rebuild an allowlisted email DOM, then isolate it in a scriptless sandbox. */
window.renderSafeMail = function(container, html, text, attachments=[]) {
  container.replaceChildren();
  if (!html) { const body=document.createElement("div");body.style.cssText="padding:22px;white-space:pre-wrap";body.textContent=text||"(testo non disponibile)";container.append(body);return; }
  const source=new DOMParser().parseFromString(String(html),"text/html");
  const output=document.implementation.createHTMLDocument("");
  const tags=new Set("a p div span br hr table thead tbody tfoot tr td th caption colgroup col blockquote pre code b strong i em u s strike ul ol li h1 h2 h3 h4 h5 h6 img center font sub sup small".split(" "));
  const drop=new Set("script style iframe object embed form input button textarea select link meta base svg math template video audio".split(" "));
  const styles=new Set("color background-color font-family font-size font-weight font-style text-align text-decoration line-height padding padding-left padding-right padding-top padding-bottom margin margin-left margin-right margin-top margin-bottom border border-width border-style border-color border-collapse border-spacing vertical-align width max-width height white-space".split(" "));
  function copy(node,parent) {
    if(node.nodeType===3){parent.append(output.createTextNode(node.textContent));return;}
    if(node.nodeType!==1)return;
    const name=node.localName.toLowerCase();
    if(drop.has(name))return;
    let target=parent;
    if(tags.has(name)){
      target=output.createElement(name); parent.append(target);
      for(const attr of ["class","id","title","alt","bgcolor","color","face","size","colspan","rowspan","cellpadding","cellspacing","width","height","align","dir"]){
        if(node.hasAttribute(attr))target.setAttribute(attr,node.getAttribute(attr));
      }
      for(const key of styles){const value=node.style.getPropertyValue(key);
        if(value && !/url\s*\(|expression|@|\\|[<>]/i.test(value))target.style.setProperty(key,value);}
      if(name==="a"){
        try {const u=new URL(node.getAttribute("href"));
          if(["https:","http:","mailto:"].includes(u.protocol)){
            target.href=u.href;target.target="_blank";target.rel="noopener noreferrer";
          }
        }catch(_){}
      }
      if(name==="img"){
        try {let src=node.getAttribute("src")||"";
          if(src.startsWith("cid:")){const id=decodeURIComponent(src.slice(4)).replace(/^<|>$/g,"");src=attachments.find(a=>String(a.contentId||a.cid||"").replace(/^<|>$/g,"")===id)?.url||"";}
          const u=new URL(src);if(u.protocol==="https:" || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)){
          target.src=u.href;target.referrerPolicy="no-referrer";target.loading="lazy";
        }}catch(_){}
      }
    }
    for(const child of node.childNodes)copy(child,target);
  }
  // Email templates often keep their presentation in style elements. The iframe
  // isolates selectors; remove external resources and active/escaped CSS constructs.
  for(const style of source.querySelectorAll("style")){
    const css=style.textContent;
    if(!/@import|url\s*\(|expression|javascript|[\\<>]/i.test(css)){
      const safe=output.createElement("style");safe.textContent=css;output.body.append(safe);
    }
  }
  for(const child of source.body.childNodes)copy(child,output.body);
  const frame=document.createElement("iframe");
  frame.title="Contenuto email";
  frame.setAttribute("sandbox","allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy="no-referrer";
  frame.style.cssText="display:block;width:100%;height:100%;min-height:100%;border:0;background:white";
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere;margin:12px;color:#202124}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{border-left:2px solid #ddd;padding-left:12px}</style></head><body>'+output.body.innerHTML+'</body></html>';
  container.append(frame);
};

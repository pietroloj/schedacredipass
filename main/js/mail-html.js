/* Rebuild an allowlisted email DOM, then isolate it in a scriptless sandbox. */
window.renderSafeMail = function(container, html, text) {
  container.replaceChildren();
  if (!html) { container.textContent=text||"(testo non disponibile)"; return; }
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
      for(const attr of ["title","alt","colspan","rowspan","cellpadding","cellspacing","width","height","align","dir"]){
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
        try {const u=new URL(node.getAttribute("src"));if(u.protocol==="https:"){
          target.src=u.href;target.referrerPolicy="no-referrer";target.loading="lazy";
        }}catch(_){}
      }
    }
    for(const child of node.childNodes)copy(child,target);
  }
  for(const child of source.body.childNodes)copy(child,output.body);
  const frame=document.createElement("iframe");
  frame.title="Contenuto email";
  frame.setAttribute("sandbox","allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy="no-referrer";
  frame.style.cssText="width:100%;height:650px;border:0;background:white";
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>body{font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere;margin:12px;color:#202124}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{border-left:2px solid #ddd;padding-left:12px}</style></head><body>'+output.body.innerHTML+'</body></html>';
  container.append(frame);
};

function title(value) {
  return String(value || '').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('it-IT').replace(/(^|[\s(])\p{L}/gu,x=>x.toLocaleUpperCase('it-IT'));
}
function displaySource(lead) {
  const source=String(lead.source || '').trim();
  const city=String(lead.partner || '').match(/\(([^()]+)\)/)?.[1]?.trim();
  if (/^professionecasa$/i.test(source)) return city ? `Professionecasa ${title(city)}` : 'Professionecasa';
  if (/^santucci[_\s-]*tik\s*tok$/i.test(source)) return 'Santucci Tik Tok';
  return [title(source || 'Da verificare'),title(lead.subchannel),title(lead.partner)].filter(Boolean).join(' / ');
}
module.exports={title,displaySource};

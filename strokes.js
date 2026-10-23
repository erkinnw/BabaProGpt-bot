function strokeCount(px, mask){
  const set=new Set(px);
  let strokes=0;
  const ys=new Set(px.map(i=>(i/128)|0));
  for (const y of ys){
    let run=false;
    for(let x=0;x<128;x++){
      const yes=set.has(y*128+x);
      if(yes&&!run)strokes++;
      run=yes;
    }
  }
  return strokes;
}
module.exports = { strokeCount };

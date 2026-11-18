/** Explicit construct requirements, never inferred merely from the model SQL. */
export function questionRequirements(text = '') {
    const plain=String(text).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
    const forbidden=[],required=[];
    if(/\bohne\s+(?:eine?\s+)?join(?:[-\s]operation(?:en)?)?\b|\bwithout\s+(?:any\s+)?joins?\b/i.test(plain))forbidden.push('join');
    if(/durch.{0,100}(?:zwei|vereinigte).{0,100}left\s+(?:outer\s+)?join.{0,100}nachbauen/i.test(plain))required.push('left-join','union');
    const label=plain.match(/welche\s+werte.{0,40}\bin\s+([\wäöüÄÖÜ]+).{0,30}unerheblich/i);
    const freeLabels=label?[label[1].replace(/[A-Z]/g,c=>c.toLowerCase())]:[];
    const freeDiagnostics=freeLabels.length>0&&/drittes\s+tupel.{0,160}(?:z\.?\s*b\.?|zum beispiel).{0,80}union\s+select/i.test(plain);
    return {forbidden,required,freeLabels,freeDiagnostics};
}
export function constructUse(root) {
    const result={join:false,'left-join':false,union:false};
    const visit=n=>{
        if(!n?.kind)return;
        if(n.kind==='Select'&&(n.slots.from||[]).length>1)result.join=true;
        if(n.kind==='TableSource'&&n.attrs.join){result.join=true;if(/^LEFT(?: OUTER)? JOIN$/.test(n.attrs.join))result['left-join']=true;}
        if(n.kind==='CompoundSelect'&&/^UNION/.test(n.attrs.operator))result.union=true;
        for(const v of Object.values(n.slots))for(const child of Array.isArray(v)?v:[v])visit(child);
    };visit(root);return result;
}
export function requirementState(root, requirements) {
    const used=constructUse(root);
    return JSON.stringify([...(requirements?.forbidden||[]).map(k=>Boolean(used[k])),...(requirements?.required||[]).map(k=>!used[k])]);
}

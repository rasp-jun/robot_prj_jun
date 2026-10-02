// Resolve the same local import map used by the browser; no npm/network dependency.
export async function resolve(specifier,context,next){
  if(specifier==='three')return {url:new URL('../client/vendor/three/build/three.module.js',import.meta.url).href,shortCircuit:true};
  if(specifier.startsWith('three/addons/'))return {url:new URL('../client/vendor/three/examples/jsm/'+specifier.slice(13),import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}

const $=s=>document.querySelector(s),views=['startView','cameraView','editorView','finishView'];
$('#accessLogout').onclick=()=>{location.assign('/cdn-cgi/access/logout');};
const photo=$('#photoCanvas'),draw=$('#drawCanvas'),pctx=photo.getContext('2d'),dctx=draw.getContext('2d'),wrap=$('#canvasWrap'),textLayer=$('#textLayer');
let stream,imageData,strokes=[],currentStroke,color='#ef4444',penThickness=1.95,penActive=false,finishedBlob,conversionSnapshot=null,erasedRegions=[],activeTextEntry=null,textHoldTouchId=null,textScaleState=null;
const finishButton=document.createElement('button');finishButton.id='backToStart';finishButton.className='floating-button finish-button';finishButton.type='button';finishButton.textContent='Ferdig';finishButton.setAttribute('aria-label','Ferdig');wrap.append(finishButton);
function show(id){views.forEach(v=>$('#'+v).classList.toggle('hidden',v!==id));}function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
async function camera(){try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});$('#camera').srcObject=stream;show('cameraView');}catch{toast('Kamera kunne ikke apnes. Velg et bilde i stedet.');}}function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;}
function loadImage(src){const img=new Image();img.onload=()=>{imageData={width:img.naturalWidth,height:img.naturalHeight,src:img};setupEditor();};img.src=src;}
function setupEditor(){stopCamera();finishedBlob=null;photo.width=draw.width=imageData.width;photo.height=draw.height=imageData.height;pctx.drawImage(imageData.src,0,0,photo.width,photo.height);strokes=[];erasedRegions=[];textLayer.innerHTML='';show('editorView');requestAnimationFrame(()=>{resizeLayers();render();});setPen(false);}
function resizeLayers(){if(!photo.width)return;const b=wrap.getBoundingClientRect(),r=Math.min(1,(b.width*.9)/photo.width,(b.height*.9)/photo.height),w=Math.ceil(photo.width*r),h=Math.ceil(photo.height*r);[photo,draw,textLayer].forEach(el=>{el.style.width=w+'px';el.style.height=h+'px';});}addEventListener('resize',resizeLayers);
function pos(e){const r=draw.getBoundingClientRect();return{x:(e.clientX-r.left)*draw.width/r.width,y:(e.clientY-r.top)*draw.height/r.height};}function paintStrokes(ctx,list){for(const s of list){ctx.strokeStyle=s.color;ctx.lineWidth=s.width;ctx.lineJoin=ctx.lineCap='round';ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}}function clearRecognizedInk(ctx,white=false){for(const r of erasedRegions){if(white){ctx.fillStyle='#fff';ctx.fillRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);}else ctx.clearRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);}}function render(){dctx.clearRect(0,0,draw.width,draw.height);paintStrokes(dctx,strokes);clearRecognizedInk(dctx);}
function startDraw(e){if(!penActive)return;e.preventDefault();draw.setPointerCapture?.(e.pointerId);const visibleWidth=Math.max(1,draw.getBoundingClientRect().width),standardVisibleWidth=4;currentStroke={color,width:standardVisibleWidth*(draw.width/visibleWidth)*(penThickness/1.95),points:[pos(e)]};strokes.push(currentStroke);}function moveDraw(e){if(!currentStroke)return;e.preventDefault();currentStroke.points.push(pos(e));render();}function endDraw(){currentStroke=null;}draw.addEventListener('pointerdown',startDraw);draw.addEventListener('pointermove',moveDraw);draw.addEventListener('pointerup',endDraw);draw.addEventListener('pointercancel',endDraw);
function setPen(on){penActive=on;wrap.classList.toggle('pen-mode',on);if(on)wrap.classList.remove('text-mode');$('#penTool').classList.toggle('active',on);}$('#penTool').onclick=()=>setPen(!penActive);document.querySelectorAll('.color').forEach(b=>b.onclick=()=>{color=b.dataset.color;document.querySelectorAll('.color').forEach(x=>x.classList.toggle('selected',x===b));if(activeTextEntry?.isConnected){activeTextEntry.style.setProperty('--text-color',color);activeTextEntry.focus({preventScroll:true});}});document.querySelectorAll('.pen-width').forEach(b=>b.onclick=()=>{penThickness=Number(b.dataset.width);document.querySelectorAll('.pen-width').forEach(x=>x.classList.toggle('selected',x===b));});
$('#undo').onclick=()=>{strokes=[];erasedRegions=[];textLayer.innerHTML='';conversionSnapshot=null;render();};$('#closeCamera').onclick=()=>{stopCamera();show('startView');};$('#takePhoto').onclick=()=>{const v=$('#camera'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);loadImage(c.toDataURL('image/jpeg',.92));};function closeImageSource(){const dialog=$('#imageSourceDialog');dialog.classList.add('is-closing');const done=e=>{if(e.target!==dialog)return;dialog.classList.add('hidden');dialog.classList.remove('is-closing');dialog.removeEventListener('animationend',done);};dialog.addEventListener('animationend',done);}$('#openImageSource').onclick=()=>{const dialog=$('#imageSourceDialog');dialog.classList.remove('hidden','is-closing');};$('#imageSourceDialog').onclick=e=>{if(e.target===e.currentTarget)closeImageSource();};['imageUpload','cameraUpload'].forEach(id=>$('#'+id).onchange=e=>{const f=e.target.files[0];if(f)loadImage(URL.createObjectURL(f));e.target.value='';});
function bounds(s){const x=s.points.map(p=>p.x),y=s.points.map(p=>p.y);return{x0:Math.min(...x),y0:Math.min(...y),x1:Math.max(...x),y1:Math.max(...y)};}function overlaps(a,b,pad=18){return a.x0<=b.x1+pad&&a.x1>=b.x0-pad&&a.y0<=b.y1+pad&&a.y1>=b.y0-pad;}function containedIn(a,b,pad){return a.x0>=b.x0-pad&&a.x1<=b.x1+pad&&a.y0>=b.y0-pad&&a.y1<=b.y1+pad;}function colorAt(b){const s=strokes.find(x=>overlaps(bounds(x),b));return s?.color||color;}function strokeLength(s){return s.points.slice(1).reduce((total,p,i)=>total+Math.hypot(p.x-s.points[i].x,p.y-s.points[i].y),0);}function isLongStraightLine(s,b){if(s.points.length<2)return false;const length=strokeLength(s),first=s.points[0],last=s.points.at(-1),direct=Math.hypot(last.x-first.x,last.y-first.y),boxSize=Math.max(b.x1-b.x0,b.y1-b.y0);return length>Math.max(photo.width*.12,boxSize*1.8)&&direct/Math.max(length,1)>.9;}function strokeIsTextInk(s,b){const boxSize=Math.max(b.x1-b.x0,b.y1-b.y0),pad=Math.max(32,boxSize*.45),a=bounds(s);if(containedIn(a,b,pad))return true;return overlaps(a,b,pad)&&!isLongStraightLine(s,b);}function eraseRegion(b){const boxSize=Math.max(b.x1-b.x0,b.y1-b.y0),pad=Math.max(30,photo.width/100,boxSize*.28);return{x0:Math.max(0,b.x0-pad),y0:Math.max(0,b.y0-pad),x1:Math.min(draw.width,b.x1+pad),y1:Math.min(draw.height,b.y1+pad)};}function sameRegion(a,b){return a.x0<=b.x1&&a.x1>=b.x0&&a.y0<=b.y1&&a.y1>=b.y0;}
function addText(item){const b=item.box,size=Math.max(17,Math.min(92,(b.y1-b.y0)*1.2)),r=textLayer.getBoundingClientRect(),input=document.createElement('input');input.className='text-entry';input.value=item.text;input.style.left=(b.x0/draw.width*r.width)+'px';input.style.top=(b.y0/draw.height*r.height)+'px';input.style.setProperty('--font-size',size+'px');input.style.setProperty('--text-color',colorAt(b));input.dataset.x=b.x0;input.dataset.y=b.y0;input.dataset.size=size;input.style.width=Math.max(55,item.text.length*size*.64+17)+'px';input.addEventListener('input',()=>{if(!input.value.trim()){input.remove();return;}input.style.width=Math.max(55,input.value.length*size*.64+17)+'px';});makeMovable(input);textLayer.append(input);}
function makeMovable(el){let start,pinch,moved=false;el.style.touchAction='none';const resize=size=>{const s=Math.max(12,Math.min(160,size));el.dataset.size=s;el.style.setProperty('--font-size',s+'px');el.style.width=Math.max(48,el.value.length*s*.64+17)+'px';};el.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&e.isPrimary===false)return;el.setPointerCapture?.(e.pointerId);moved=false;start={x:e.clientX,y:e.clientY,left:parseFloat(el.style.left),top:parseFloat(el.style.top)};});el.addEventListener('pointermove',e=>{if(!start||pinch)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)+Math.abs(dy)<4)return;moved=true;e.preventDefault();const r=textLayer.getBoundingClientRect(),left=start.left+dx,top=start.top+dy;el.style.left=left+'px';el.style.top=top+'px';el.dataset.x=left/r.width*draw.width;el.dataset.y=top/r.height*draw.height;});el.addEventListener('pointerup',()=>start=null);el.addEventListener('pointercancel',()=>start=null);el.addEventListener('touchstart',e=>{if(e.touches.length===2){const[a,b]=e.touches;pinch={distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),size:Number(el.dataset.size)};start=null;}},{passive:false});el.addEventListener('touchmove',e=>{if(!pinch||e.touches.length!==2)return;e.preventDefault();const[a,b]=e.touches,distance=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);resize(pinch.size*distance/pinch.distance);},{passive:false});el.addEventListener('touchend',e=>{if(e.touches.length<2)pinch=null;});}
function inkImage(){const c=document.createElement('canvas'),x=c.getContext('2d');c.width=draw.width;c.height=draw.height;x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);paintStrokes(x,strokes);clearRecognizedInk(x,true);return c.toDataURL('image/png');}
async function recognize(){if(!strokes.length){toast('Tegn tekst eller tall forst.');return;}toast('AI vurderer markeringene ...');try{const res=await fetch('/.netlify/functions/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:inkImage(),width:draw.width,height:draw.height})});if(!res.ok)throw Error(await res.text());const {items}=await res.json();const fresh=(items||[]).filter(item=>item?.text?.trim()&&item.box&&Number.isFinite(item.box.x0)&&Number.isFinite(item.box.y0)&&Number.isFinite(item.box.x1)&&Number.isFinite(item.box.y1)&&!erasedRegions.some(region=>sameRegion(region,item.box)));if(!fresh.length)throw Error('Ingen ny tekst ble funnet');conversionSnapshot=strokes.map(s=>({...s,points:s.points.map(p=>({...p}))}));fresh.forEach(item=>{addText(item);erasedRegions.push(eraseRegion(item.box));});strokes=strokes.filter(stroke=>!fresh.some(item=>strokeIsTextInk(stroke,item.box)));render();setPen(false);toast('Teksten er klar, og håndskriften er fjernet.');}catch(error){console.error('AI recognition error:',error);const m=String(error.message||'');toast(m.includes('OPENAI_API_KEY')?'API-nokkelen mangler i Netlify.':m.includes('404')||m.includes('not found')?'AI-funksjonen er ikke deployet.':m.includes('quota')||m.includes('billing')?'OpenAI-prosjektet mangler betaling eller kreditt.':'AI-feil: '+m.slice(0,90));}}$('#recognizeTool').onclick=recognize;
function exportImage(){const c=document.createElement('canvas'),x=c.getContext('2d'),layerWidth=Math.max(1,textLayer.getBoundingClientRect().width),sourceScale=draw.width/layerWidth;c.width=photo.width;c.height=photo.height;x.drawImage(photo,0,0);x.drawImage(draw,0,0);textLayer.querySelectorAll('.text-entry').forEach(el=>{const s=(Number(el.dataset.size)||20)*sourceScale;x.font=`700 ${s}px system-ui`;x.fillStyle=el.style.getPropertyValue('--text-color')||'#fff';x.fillText(el.value,Number(el.dataset.x),Number(el.dataset.y)+s);});return new Promise(ok=>c.toBlob(ok,'image/jpeg',.94));}$('#backToStart').onclick=async()=>{finishedBlob=await exportImage();show('finishView');};
function downloadImage(){const a=document.createElement('a');a.href=URL.createObjectURL(finishedBlob);a.download='befaringsskisse.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}async function shareImage(){const f=new File([finishedBlob],'befaringsskisse.jpg',{type:'image/jpeg'});if(navigator.share&&navigator.canShare?.({files:[f]})){try{await navigator.share({title:'Befaringsskisse',text:'Befaringsskisse',files:[f]});return;}catch(error){if(error?.name==='AbortError')return;}}downloadImage();}$('#shareImage').onclick=shareImage;$('#downloadImage').onclick=downloadImage;if('serviceWorker'in navigator){navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});navigator.serviceWorker.register('./sw.js').catch(()=>{});}

function addManualTextBox(){
  const size=Math.max(20,Math.min(38,photo.width/30));
  const layer=textLayer.getBoundingClientRect();
  const input=document.createElement('input');
  input.className='text-entry';
  input.type='text';
  input.placeholder='Skriv tekst';
  input.autocomplete='off';
  const initialWidth=Math.max(160,size*7);
  input.style.left=((layer.width-initialWidth)/2)+'px';
  input.style.top=((layer.height-size)/2)+'px';
  input.style.setProperty('--font-size',size+'px');
  input.style.setProperty('--text-color',color);
  input.dataset.x=((layer.width-initialWidth)/2)/layer.width*draw.width;
  input.dataset.y=((layer.height-size)/2)/layer.height*draw.height;
  input.dataset.size=size;
  input.style.width=initialWidth+'px';
  input.addEventListener('input',()=>{const currentSize=Number(input.dataset.size)||size;if(!input.value.trim()){closeEmptyTextEntry(input);return;}input.style.width=Math.max(110,input.value.length*currentSize*.64+28)+'px';});
  input.addEventListener('focus',()=>{activeTextEntry=input;wrap.classList.add('text-mode');});
  input.addEventListener('touchstart',event=>{const touch=[...event.changedTouches].find(item=>item.target===input)||event.changedTouches[0];if(touch){activeTextEntry=input;textHoldTouchId=touch.identifier;}},{passive:true});
  input.addEventListener('blur',()=>{setTimeout(()=>{if(!input.value.trim()&&document.activeElement!==input)closeEmptyTextEntry(input);restoreEditorViewport();},0);});
  makeMovable(input);
  textLayer.append(input);
  activeTextEntry=input;
  input.focus();
}

function resizeActiveText(size){
  if(!activeTextEntry?.isConnected)return;
  const nextSize=Math.max(16,Math.min(160,size));
  activeTextEntry.dataset.size=nextSize;
  activeTextEntry.style.setProperty('--font-size',nextSize+'px');
  activeTextEntry.style.width=Math.max(48,activeTextEntry.value.length*nextSize*.64+28)+'px';
}

document.addEventListener('touchstart',event=>{
  if(!activeTextEntry?.isConnected||textHoldTouchId===null||event.touches.length<2)return;
  const held=[...event.touches].find(touch=>touch.identifier===textHoldTouchId);
  const other=[...event.touches].find(touch=>touch.identifier!==textHoldTouchId);
  if(!held||!other)return;
  textScaleState={distance:Math.hypot(held.clientX-other.clientX,held.clientY-other.clientY),size:Number(activeTextEntry.dataset.size)||20};
},{passive:false});
document.addEventListener('touchmove',event=>{
  if(!textScaleState||!activeTextEntry?.isConnected)return;
  const held=[...event.touches].find(touch=>touch.identifier===textHoldTouchId);
  const other=[...event.touches].find(touch=>touch.identifier!==textHoldTouchId);
  if(!held||!other)return;
  event.preventDefault();
  const distance=Math.hypot(held.clientX-other.clientX,held.clientY-other.clientY);
  resizeActiveText(textScaleState.size*distance/Math.max(1,textScaleState.distance));
},{passive:false});
document.addEventListener('touchend',event=>{
  if(![...event.touches].some(touch=>touch.identifier===textHoldTouchId))textHoldTouchId=null;
  if(event.touches.length<2)textScaleState=null;
},{passive:true});

function restoreEditorViewport(){
  requestAnimationFrame(()=>window.scrollTo(0,0));
}
function closeEmptyTextEntry(input){
  if(!input?.isConnected)return;
  if(activeTextEntry===input)activeTextEntry=null;
  input.remove();
  wrap.classList.remove('text-mode');
  restoreEditorViewport();
}

// Text always starts by choosing its colour. The text field is added only after that choice.
$('#penTool').onclick=()=>{wrap.classList.remove('text-colour-mode');setPen(!penActive);};
$('#recognizeTool').onclick=()=>{
  setPen(false);
  wrap.classList.toggle('text-colour-mode');
};
document.querySelectorAll('.text-color').forEach(button=>button.onclick=()=>{
  color=button.dataset.color;
  document.querySelectorAll('.text-color').forEach(item=>item.classList.toggle('selected',item===button));
  document.querySelectorAll('.color').forEach(item=>item.classList.toggle('selected',item.dataset.color===color));
  wrap.classList.remove('text-colour-mode');
  wrap.classList.add('text-mode');
  addManualTextBox();
});


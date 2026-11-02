let installPrompt;
const statusEl=document.querySelector('#networkStatus'),installBtn=document.querySelector('#installApp');
function updateStatus(){statusEl.textContent=navigator.onLine?'آفلاین آماده است · اطلاعات روی این دستگاه':'آفلاین · اطلاعات روی این دستگاه'}
window.addEventListener('online',updateStatus);window.addEventListener('offline',updateStatus);updateStatus();
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker:',err));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;installBtn.classList.remove('hidden')});
installBtn.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;installBtn.classList.add('hidden')});

(() => {
  const $ = id => document.getElementById(id);
  const state = { products: [], items: [], id: null, taxRateBp: 0, moneyDisplay: 'irr', busy: false };
  const countUnits = ['عدد','بسته','سرویس'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fa = value => new Intl.NumberFormat('fa-IR',{maximumFractionDigits:3}).format(value);
  const money = value => { const amount = state.moneyDisplay === 'irt' ? Math.round(value/10) : value; return new Intl.NumberFormat('fa-IR',{maximumFractionDigits:0}).format(amount)+(state.moneyDisplay==='irt'?' تومان':' ریال'); };
  const jalali = value => { if(!value)return ''; const p=value.split('-').map(Number); return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(p[0],p[1]-1,p[2],12))); };
  const today = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const round = (a,b) => Number((BigInt(a)+BigInt(b)/2n)/BigInt(b));
  const amountFor = item => {
    const gross=round(BigInt(item.unitPriceIrr)*BigInt(item.quantityMilli),1000n);
    const discount=item.discountType==='fixed'?Math.min(gross,item.discountValue||0):item.discountType==='percent'?round(BigInt(gross)*BigInt(Math.min(100,item.discountValue||0)),100n):0;
    const net=gross-discount, tax=round(BigInt(net)*BigInt(state.taxRateBp),10000n);
    return {gross,discount,net,tax,total:net+tax};
  };
  function showError(message){$('pos-error').textContent=message;$('pos-error').hidden=false;}
  function renderResults(query=''){
    const term=query.trim().toLocaleLowerCase('fa');
    const rows=state.products.filter(p=>!term||p.name.toLocaleLowerCase('fa').includes(term)||p.code.toLocaleLowerCase('fa').includes(term)).slice(0,30);
    $('pos-results').innerHTML=rows.length?rows.map(p=>'<button type="button" class="pos-product" data-pos-add="'+p.id+'"><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+' · '+esc(p.unit)+' · موجودی '+fa((p.stockMilli||0)/1000)+'</small></span><b>'+money(p.salePriceIrr)+'</b></button>').join(''):'<p class="empty-cell">کالایی پیدا نشد.</p>';
  }
  function renderCart(){
    $('pos-cart-count').textContent=fa(state.items.length)+' قلم';
    $('pos-cart').innerHTML=state.items.length?state.items.map((item,i)=>{const p=state.products.find(x=>x.id===item.productId);const amount=amountFor(item);return '<div class="pos-cart-item" data-pos-row="'+i+'"><div class="pos-cart-name"><strong>'+esc(p?.name||'کالا')+'</strong><small>'+esc(p?.code||'')+' · '+esc(p?.unit||'')+'</small></div><label>تعداد<input data-pos-qty type="number" min="'+(countUnits.includes(p?.unit)?'1':'0.001')+'" step="'+(countUnits.includes(p?.unit)?'1':'0.001')+'" value="'+(item.quantityMilli/1000)+'"></label><label>قیمت واحد<input data-pos-price type="number" min="0" step="1" value="'+item.unitPriceIrr+'"></label><label class="pos-discount">تخفیف<select data-pos-discount-type><option value="none" '+(item.discountType==='none'?'selected':'')+'>بدون تخفیف</option><option value="fixed" '+(item.discountType==='fixed'?'selected':'')+'>مبلغ ثابت</option><option value="percent" '+(item.discountType==='percent'?'selected':'')+'>درصد</option></select><input data-pos-discount-value type="number" min="0" max="'+(item.discountType==='percent'?'100':'')+'" step="1" value="'+(item.discountValue||0)+'"></label><strong class="pos-line-total">'+money(amount.total)+'</strong><button class="remove-item" type="button" data-pos-remove="'+i+'" aria-label="حذف قلم">×</button></div>';}).join(''):'<p class="empty-cell">هنوز کالایی به سبد اضافه نشده است.</p>';
    let subtotal=0,discount=0,tax=0,total=0;for(const item of state.items){const a=amountFor(item);subtotal+=a.gross;discount+=a.discount;tax+=a.tax;total+=a.total;}
    $('pos-subtotal').textContent=money(subtotal);$('pos-discount-total').textContent=money(discount);$('pos-tax').textContent=money(tax);$('pos-total').textContent=money(total);
  }
  async function open(doc=null){
    const [products,inventory,settings]=await Promise.all([window.marketApp.listProducts({activeOnly:true}),window.marketApp.listInventory(),window.marketApp.getSettings()]);
    if(!products.length){alert('ابتدا حداقل یک کالای فعال ثبت کنید.');return;}
    const stock=new Map(inventory.map(x=>[x.id,x.quantityMilli]));
    state.products=products.map(p=>({...p,stockMilli:stock.get(p.id)||0}));state.items=(doc?.items||[]).map(x=>({productId:x.productId,quantityMilli:x.quantityMilli,unitPriceIrr:x.unitPriceIrr,discountType:x.discountType||'none',discountValue:x.discountValue||0}));state.id=doc?.id||null;state.taxRateBp=Number(settings.tax_rate_bp||0);state.moneyDisplay=settings.money_display||'irr';
    $('pos-date').value=doc?.documentDate||today();$('pos-date-jalali').textContent=jalali($('pos-date').value);$('pos-party').value=doc?.partyName||'';$('pos-notes').value=doc?.notes||'';$('pos-search').value='';$('pos-error').hidden=true;
    $('pos-heading-title').textContent=doc?'ادامهٔ پیش‌نویس فروش':'ثبت فروش جدید';
    $('pos-workspace').hidden=false;document.querySelector('.sales-shortcuts').hidden=true;$('sales-invoices').hidden=true;renderCart();renderResults();$('pos-search').focus();
  }
  function close(){ $('pos-workspace').hidden=true;document.querySelector('.sales-shortcuts').hidden=false;$('sales-invoices').hidden=false;state.items=[];state.id=null; }
  async function submit(finalize){
    if(state.busy)return;if(!state.items.length){showError('سبد فروش خالی است.');return;}
    if(!$('pos-date').value){showError('تاریخ فروش را انتخاب کنید.');return;}
    for(const item of state.items){const p=state.products.find(x=>x.id===item.productId);if(!Number.isSafeInteger(item.quantityMilli)||item.quantityMilli<=0||(countUnits.includes(p?.unit)&&item.quantityMilli%1000!==0)){showError('مقدار یکی از اقلام معتبر نیست.');return;}if(!Number.isSafeInteger(item.unitPriceIrr)||item.unitPriceIrr<0){showError('قیمت یکی از اقلام معتبر نیست.');return;}if(item.discountType==='percent'&&(item.discountValue<0||item.discountValue>100)){showError('درصد تخفیف باید بین صفر تا ۱۰۰ باشد.');return;}}
    state.busy=true;$('pos-save-draft').disabled=true;$('pos-finalize').disabled=true;$('pos-error').hidden=true;
    try{
      const saved=await window.marketApp.saveDocumentDraft({id:state.id,type:'sale',documentDate:$('pos-date').value,partyName:$('pos-party').value,notes:$('pos-notes').value,items:state.items.map(x=>({...x,taxRateBp:state.taxRateBp}))});state.id=saved.id;
      if(finalize){const preview=await window.marketApp.previewDocumentFinalization(saved.id);if(preview.warnings?.length){const warning=preview.warnings.map(x=>x.productName+' (موجودی '+fa(x.stockMilli/1000)+'، فروش '+fa(x.quantityMilli/1000)+')').join('، ');if(!confirm('هشدار موجودی ناکافی:\n'+warning+'\n\nفروش با موجودی منفی مجاز است. ثبت قطعی انجام شود؟')){if(typeof toast==='function')toast('پیش‌نویس ذخیره شد؛ ثبت قطعی لغو شد.');return;}}
        const result=await window.marketApp.finalizeDocument(saved.id);if(result.warnings?.length)toast('فروش ثبت شد؛ برای برخی اقلام بهای تمام‌شده تخمینی یا نامشخص است.',true);else toast('فروش '+result.documentNumber+' قطعی شد.');}
      else toast('پیش‌نویس فروش ذخیره شد.');
      close();await renderDocuments('sale');await renderInventory();await renderDashboard();
    }catch(error){showError(error.message||'ثبت فروش ناموفق بود.');}
    finally{state.busy=false;$('pos-save-draft').disabled=false;$('pos-finalize').disabled=false;}
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-pos-open]'))open().catch(e=>showError(e.message));
    if(event.target.closest('[data-pos-close]'))close();
    const edit=event.target.closest('[data-pos-edit]');if(edit)window.marketApp.getDocument(Number(edit.dataset.posEdit)).then(doc=>open(doc)).catch(e=>showError(e.message));
    const add=event.target.closest('[data-pos-add]');if(add){const p=state.products.find(x=>x.id===Number(add.dataset.posAdd));if(p){const old=state.items.find(x=>x.productId===p.id);if(old)old.quantityMilli+=1000;else state.items.push({productId:p.id,quantityMilli:1000,unitPriceIrr:p.salePriceIrr,discountType:'none',discountValue:0});renderCart();}}
    const remove=event.target.closest('[data-pos-remove]');if(remove){state.items.splice(Number(remove.dataset.posRemove),1);renderCart();}
  });
  document.addEventListener('input',event=>{if(event.target.id==='pos-search')renderResults(event.target.value);});
  $('pos-cart').addEventListener('change',event=>{const row=event.target.closest('[data-pos-row]');if(!row)return;const item=state.items[Number(row.dataset.posRow)];if(event.target.matches('[data-pos-qty]'))item.quantityMilli=Math.round(Number(event.target.value)*1000);if(event.target.matches('[data-pos-price]'))item.unitPriceIrr=Math.max(0,Math.trunc(Number(event.target.value)||0));if(event.target.matches('[data-pos-discount-type]')){item.discountType=event.target.value;item.discountValue=0;}if(event.target.matches('[data-pos-discount-value]'))item.discountValue=Math.max(0,Math.trunc(Number(event.target.value)||0));renderCart();});
  $('pos-date').addEventListener('change',()=>{$('pos-date-jalali').textContent=jalali($('pos-date').value);});
  $('pos-save-draft').addEventListener('click',()=>submit(false));$('pos-finalize').addEventListener('click',()=>submit(true));
})();
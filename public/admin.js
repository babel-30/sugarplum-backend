// admin.js
// Assumes API_BASE is defined in config-admin.js (same-origin on backend)

// Helper: always send session cookies to the backend for admin routes
function adminFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;

  return fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function toAbsoluteUrl(maybeRelative) {
  if (!maybeRelative) return "";
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;

  // Ensure no double slashes
  const base = (API_BASE || "").replace(/\/+$/, "");
  const rel = String(maybeRelative).startsWith("/") ? maybeRelative : `/${maybeRelative}`;
  return `${base}${rel}`;
}

document.addEventListener("DOMContentLoaded", () => {
  // =======================
  //  AUTH GUARD
  // =======================
  async function ensureAdminSession() {
    try {
      const res = await adminFetch("/admin/me");
      if (res.ok) return true;

      window.location.href = "/admin-login";
      return false;
    } catch (err) {
      console.error("Error checking admin session:", err);
      window.location.href = "/admin-login";
      return false;
    }
  }
   // =======================
  //  PATCH MANAGER (HATS)
  // =======================
  //
  // Supports:
  // - Add patch
  // - Physical width / height in inches
  // - Edit existing patch name and dimensions
  // - Replace artwork without deleting the patch
  // - Active / inactive
  // - Preview scale and X/Y fine adjustments
  // - Delete patch
  //
  // Server routes:
  // - GET  /admin/patches
  // - PUT  /admin/patches
  // - POST /admin/patches/upload
  //
  // IMPORTANT:
  // server.js uses:
  // uploadPatchImage.single("file")
  //
  // Therefore ALL patch image uploads use
  // FormData field name "file".
  // =======================

  const patchesSection =
    document.getElementById("patches-section");

  const patchesToggleBtn =
    document.getElementById("patches-toggle-btn");

  const patchUploadForm =
    document.getElementById("patch-upload-form");

  const patchNameInput =
    document.getElementById("patchName");

  const patchWidthInput =
    document.getElementById("patchWidth");

  const patchHeightInput =
    document.getElementById("patchHeight");

  const patchActiveInput =
    document.getElementById("patchActive");

  const patchImageInput =
    document.getElementById("patchImage");

  const patchUploadStatusEl =
    document.getElementById("patch-upload-status");

  const patchesListEl =
    document.getElementById("patches-list");

  const patchesStatusEl =
    document.getElementById("patches-status");

  let patchesCache = [];
  let patchMaterials = [];
  let patchCategories = [];
  function readPatchDollars(input,label) {
    const raw=input?.value.trim()||'';if(raw==='')return null;
    const dollars=Number(raw),cents=Math.round(dollars*100);
    if(!Number.isFinite(dollars)||dollars<0||dollars>1000||Math.abs(dollars*100-cents)>.000001)throw new Error(`${label} must be between $0.00 and $1,000.00, with at most two decimals.`);
    return cents;
  }
  function patchColorRow(v={}) {
    const id=v.id||window.crypto.randomUUID();
    return `<div class="patch-color-row" data-option-id="${patchEscapeHtml(id)}"><div class="field-grid"><label>Assigned material<select class="option-material-id"><option value="">Choose a material</option>${patchMaterials.map(m=>`<option value="${patchEscapeHtml(m.id)}" ${m.id===v.materialId?'selected':''}>${patchEscapeHtml(m.name+(m.type?' / '+m.type:''))}</option>`).join('')}</select></label><label>Customer patch price ($)<input class="option-price" type="number" min="0" max="1000" step=".01" value="${priceField(v.customerPriceCents)}" placeholder="Use design/default price"></label><label>Attachment charge ($)<input class="option-attachment" type="number" min="0" max="1000" step=".01" value="${priceField(v.attachmentFeeCents)}" placeholder="Use design/default charge"></label></div><p class="admin-help-text option-stock-status">${patchEscapeHtml((v.stockStatus||'in-stock').replaceAll('-',' '))} — Stock follows the assigned master material. Photos and prices apply only to this patch option.</p><img class="option-preview" src="${patchEscapeHtml(toAbsoluteUrl(v.imageUrl||''))}" alt="Color photo"><input class="option-image" type="hidden" value="${patchEscapeHtml(v.imageUrl||'')}"><label>Upload this color’s photo<input class="option-file" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="actions"><button type="button" class="option-upload secondary">Upload Photo</button><button type="button" class="option-remove danger">Remove Color</button></div><p class="option-status" role="status"></p></div>`;
  }
  function readPatchColors(card){return Array.from(card.querySelectorAll('.patch-color-row'),row=>{const materialId=row.querySelector('.option-material-id').value,m=patchMaterials.find(m=>m.id===materialId);if(!m)throw new Error('Assign an existing material to every patch color. Add materials in the manager above.');return {id:row.dataset.optionId,materialId,name:m.name,material:m.type,customerPriceCents:readPatchDollars(row.querySelector('.option-price'),'Color patch price'),attachmentFeeCents:readPatchDollars(row.querySelector('.option-attachment'),'Color attachment charge'),stockStatus:m.stockStatus,imageUrl:row.querySelector('.option-image').value||patchesCache.find(p=>p.id===card.dataset.id)?.imageUrl};});}
  function materialSelects(replacedId,replacementId){patchesCache=patchesCache.map(p=>({...p,variants:p.variants?.map(v=>{const materialId=v.materialId===replacedId?replacementId:v.materialId,m=patchMaterials.find(m=>m.id===materialId);return m?{...v,materialId,name:m.name,material:m.type,stockStatus:m.stockStatus}:v;})}));patchesListEl?.querySelectorAll('.option-material-id').forEach(select=>{const selected=select.value===replacedId?replacementId:select.value;select.innerHTML='<option value="">Choose a material</option>'+patchMaterials.map(m=>`<option value="${patchEscapeHtml(m.id)}">${patchEscapeHtml(m.name+(m.type?' / '+m.type:''))}</option>`).join('');select.value=selected||'';const m=patchMaterials.find(m=>m.id===select.value),hint=select.closest('.patch-color-row').querySelector('.option-stock-status');if(hint)hint.textContent=(m?m.stockStatus.replaceAll('-',' ')+' — ':'')+'Stock follows the assigned master material. Photos and prices apply only to this patch option.';});}
  async function materialRequest(path,method='GET',body){const res=await adminFetch('/admin/patch-materials'+path,{method,...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Could not save material.');return data;}
  function renderMaterials(){const list=document.getElementById('material-list');if(!list)return;list.innerHTML=patchMaterials.length?patchMaterials.map(m=>`<div class="material-card" data-material-id="${patchEscapeHtml(m.id)}"><div class="field-grid"><label>Color / engraving<input class="material-name" maxlength="100" value="${patchEscapeHtml(m.name)}"></label><label>Material / type<input class="material-type" maxlength="100" value="${patchEscapeHtml(m.type)}"></label></div><div class="actions"><label class="check"><input class="material-low" type="checkbox" ${m.stockStatus==='low-stock'?'checked':''}>Low stock</label><label class="check"><input class="material-out" type="checkbox" ${m.stockStatus==='out-of-stock'?'checked':''}>Out of stock</label><span>${m.assignedOptions||0} assigned patch options</span></div><p class="admin-help-text">Stock checkboxes save immediately across all assigned patches. Neither checked = in stock.</p><div class="actions"><button type="button" class="material-save">Save Name / Type</button><label>Replacement when deleting<select class="material-replacement"><option value="">Choose if assigned</option>${patchMaterials.filter(other=>other.id!==m.id).map(other=>`<option value="${patchEscapeHtml(other.id)}">${patchEscapeHtml(other.name+(other.type?' / '+other.type:''))}</option>`).join('')}</select></label><button type="button" class="material-delete danger">Delete Material</button></div></div>`).join(''):'<p>Add your first material to assign it to patch colors.</p>';}
  async function loadMaterials(){patchMaterials=(await materialRequest('')).materials;renderMaterials();}
  document.getElementById('material-add-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.target;try{const data=await materialRequest('','POST',Object.fromEntries(new FormData(form)));patchMaterials=data.materials;renderMaterials();materialSelects();form.reset();showPatchStatus(document.getElementById('material-status'),'Material added. Assign it to patch colors below.');}catch(e){showPatchStatus(document.getElementById('material-status'),e.message,true);}});
  async function changeMaterial(row,remove=false){const status=document.getElementById('material-status'),id=row.dataset.materialId,replacementId=row.querySelector('.material-replacement').value;row.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);try{const body=remove?{replacementId}:{name:row.querySelector('.material-name').value,type:row.querySelector('.material-type').value,stockStatus:row.querySelector('.material-out').checked?'out-of-stock':row.querySelector('.material-low').checked?'low-stock':'in-stock'};const data=await materialRequest('/'+encodeURIComponent(id),remove?'DELETE':'PUT',body);patchMaterials=data.materials;renderMaterials();materialSelects(remove?id:undefined,replacementId);showPatchStatus(status,remove?`Material deleted. ${data.reassigned} patch options reassigned.`:'Material saved. All assigned patch options now use this stock status.');}catch(e){showPatchStatus(status,e.message,true);const m=patchMaterials.find(m=>m.id===id);if(m){row.querySelector('.material-out').checked=m.stockStatus==='out-of-stock';row.querySelector('.material-low').checked=m.stockStatus==='low-stock';}}finally{row.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}}
  document.getElementById('material-list')?.addEventListener('change',event=>{if(!event.target.matches('.material-low,.material-out'))return;const row=event.target.closest('.material-card');if(event.target.checked)row.querySelector(event.target.matches('.material-low')?'.material-out':'.material-low').checked=false;changeMaterial(row);});
  document.getElementById('material-list')?.addEventListener('click',event=>{const button=event.target.closest('button'),row=button?.closest('.material-card');if(!row)return;if(button.matches('.material-save'))changeMaterial(row);if(button.matches('.material-delete'))changeMaterial(row,true);});
  patchesListEl?.addEventListener('click',async event=>{
    const button=event.target.closest('button'),card=button?.closest('.patch-card');if(!card)return;
    if(button.classList.contains('option-add')){card.querySelector('.patch-colors').insertAdjacentHTML('beforeend',patchColorRow({imageUrl:patchesCache.find(p=>p.id===card.dataset.id)?.imageUrl,stockStatus:'in-stock'}));card.dataset.dirty='true';return;}
    const row=button.closest('.patch-color-row');if(!row)return;
    if(button.classList.contains('option-remove')){if(card.querySelectorAll('.patch-color-row').length===1){showPatchStatus(row.querySelector('.option-status'),'Keep at least one color option. Stock is managed in the material manager.',true);return;}row.remove();card.dataset.dirty='true';return;}
    if(button.classList.contains('option-upload')){button.disabled=true;try{const url=await uploadPatchImage(row.querySelector('.option-file').files[0]);row.querySelector('.option-image').value=url;row.querySelector('.option-preview').src=toAbsoluteUrl(url);card.dataset.dirty='true';showPatchStatus(row.querySelector('.option-status'),'Photo uploaded. Save Changes to apply it.');}catch(e){showPatchStatus(row.querySelector('.option-status'),e.message,true);}finally{button.disabled=false;}}
  });
  function priceField(cents){return cents==null?'':(cents/100).toFixed(2);}

  function patchCategoryChecks(selected = []) {
    return patchCategories.map(c => `<label style="display:inline-flex;align-items:center;gap:6px;margin:5px 12px 5px 0"><input type="checkbox" class="patch-category-check" value="${patchEscapeHtml(c)}" ${selected.includes(c) ? 'checked' : ''}>${patchEscapeHtml(c)}</label>`).join('');
  }
  function renderNewPatchCategories() {
    const target = document.getElementById('patch-new-categories');
    if (target) { const selected = Array.from(target.querySelectorAll('input:checked'), n => n.value); target.innerHTML = '<legend>Patch Categories — choose any that apply</legend>'+patchCategoryChecks(selected); }
  }
  async function changePatchCategory(method, name) {
    const res=await adminFetch('/admin/patch-categories',{method,body:JSON.stringify({name})});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'Category update failed');return data;
  }
  function refreshPatchCategoryControls() {
    const remove=document.getElementById('patch-category-delete-select');
    const filter=document.getElementById('patch-admin-category');
    for (const target of [remove,filter]) {
      if(!target)continue;const selected=target.value;
      target.innerHTML=(target===remove?'<option value="">Choose a category</option>':'<option value="">All categories</option><option value="__uncategorized">Uncategorized</option>')+patchCategories.map(c=>`<option value="${patchEscapeHtml(c)}">${patchEscapeHtml(c)}</option>`).join('');
      if([...target.options].some(o=>o.value===selected))target.value=selected;
    }
  }
  function filterPatchCards() {
    const query=(document.getElementById('patch-admin-search')?.value||'').trim().toLowerCase();
    const category=document.getElementById('patch-admin-category')?.value||'';
    const active=document.getElementById('patch-admin-active')?.value||'';let visible=0;
    patchesListEl?.querySelectorAll('.patch-card').forEach(card=>{
      const name=card.querySelector('.patch-edit-name')?.value||'';
      const categories=Array.from(card.querySelectorAll('.patch-edit-categories input:checked'),i=>i.value);
      const enabled=card.querySelector('.patch-active-toggle')?.checked;
      card.hidden=!!(query&&!name.toLowerCase().includes(query)||category&&(category==='__uncategorized'?categories.length>0:!categories.includes(category))||active&&(active==='active'?!enabled:enabled));
      if(!card.hidden)visible++;
    });
    const count=document.getElementById('patch-admin-count');if(count)count.textContent=`${visible} of ${patchesCache.length} patches`;
  }
  for(const id of ['patch-admin-search','patch-admin-category','patch-admin-active'])document.getElementById(id)?.addEventListener('input',filterPatchCards);
  document.getElementById('patch-category-add')?.addEventListener('click', async () => {
    const input = document.getElementById('patch-category-name'),button=document.getElementById('patch-category-add'),status=document.getElementById('patch-category-status');
    const name=input.value.trim().slice(0,60);if(!name){showPatchStatus(status,'Enter a category name.',true);return;}
    button.disabled=true;
    try { const data=await changePatchCategory('POST',name);patchCategories=data.categories;input.value='';renderNewPatchCategories();refreshPatchCategoryControls();
      document.querySelectorAll('.patch-edit-categories').forEach(target=>{const label=document.createElement('label');label.className='category-check';const check=document.createElement('input');check.type='checkbox';check.className='patch-category-check';check.value=name;label.append(check,document.createTextNode(name));target.append(label);});
      showPatchStatus(status,'Category added. Assign it to any patches you choose.');
    }catch(e){showPatchStatus(status,e.message,true);}finally{button.disabled=false;}
  });
  document.getElementById('patch-category-delete')?.addEventListener('click',async()=>{
    const name=document.getElementById('patch-category-delete-select').value,button=document.getElementById('patch-category-delete'),status=document.getElementById('patch-category-status');
    if(!name){showPatchStatus(status,'Choose a category to delete.',true);return;}
    const affected=patchesCache.filter(p=>(p.categories||[]).includes(name)).length;
    if(!confirm(`Delete “${name}” from ${affected} patch${affected===1?'':'es'}? All patches and their other categories will be kept. Save any pending patch edits first; the library will refresh.`))return;
    button.disabled=true;
    try{const data=await changePatchCategory('DELETE',name);await loadPatchesUI();showPatchStatus(status,`Category deleted. ${data.affected} patch assignments removed; all patches kept.`);}catch(e){showPatchStatus(status,e.message,true);}finally{button.disabled=false;}
  });

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------

  function showPatchStatus(
    el,
    msg,
    isError = false
  ) {
    if (!el) return;

    el.textContent = msg || "";

    el.style.color =
      isError
        ? "#a23b32"
        : "#256044";
  }


  function cacheBust(url) {
    if (!url) return url;

    const sep =
      url.includes("?")
        ? "&"
        : "?";

    return `${url}${sep}v=${Date.now()}`;
  }


  function patchEscapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function patchNumber(
    value,
    fallback
  ) {
    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }


  function patchFixed(
    value,
    fallback,
    decimals = 2
  ) {
    return patchNumber(
      value,
      fallback
    ).toFixed(decimals);
  }


  // ---------------------------------------------------------
  // Load / save patch records
  // ---------------------------------------------------------

  async function fetchAdminPatches() {
    const res =
      await adminFetch(
        "/admin/patches"
      );

    if (!res.ok) {
      throw new Error(
        "Failed to load patches"
      );
    }

    const data =
      await res
        .json()
        .catch(() => ({}));

    patchCategories = Array.isArray(data.categories) ? data.categories : patchCategories;
    renderNewPatchCategories();
    refreshPatchCategoryControls();
    return Array.isArray(
      data.patches
    )
      ? data.patches
      : [];
  }


  async function saveAdminPatches(
    nextPatches
  ) {
    const res =
      await adminFetch(
        "/admin/patches",
        {
          method: "PUT",

          body: JSON.stringify({
            patches: nextPatches,
            categories: patchCategories,
          }),
        }
      );

    if (!res.ok) {
      const txt =
        await res
          .text()
          .catch(() => "");

      throw new Error(
        `Failed to save patches (${res.status}): ${
          txt || "unknown"
        }`
      );
    }

    const data =
      await res
        .json()
        .catch(() => ({}));

    return Array.isArray(
      data.patches
    )
      ? data.patches
      : nextPatches;
  }


  // ---------------------------------------------------------
  // Upload patch artwork
  // ---------------------------------------------------------

  async function uploadPatchImage(file) {
    if (!file) {
      throw new Error(
        "Choose a patch image first."
      );
    }

    const fd =
      new FormData();

    /*
      MUST match server.js:

      uploadPatchImage.single("file")
    */
    fd.append(
      "file",
      file
    );

    /*
      Do NOT use adminFetch here.

      FormData must be sent directly with fetch()
      so the browser creates the multipart/form-data
      Content-Type and boundary automatically.
    */
    const res =
      await fetch(
        `${API_BASE}/admin/patches/upload`,
        {
          method: "POST",
          credentials: "include",
          body: fd,
        }
      );

    const contentType =
      res.headers.get(
        "content-type"
      ) || "";

    let data = null;

    if (
      contentType.includes(
        "application/json"
      )
    ) {
      data =
        await res
          .json()
          .catch(() => ({}));
    } else {
      const responseText =
        await res
          .text()
          .catch(() => "");

      data = {
        error: responseText,
      };
    }

    if (!res.ok) {
      console.error(
        "Patch upload failed:",
        data
      );

      throw new Error(
        data?.error ||
          `Patch upload failed (${res.status}).`
      );
    }

    if (!data?.url) {
      console.error(
        "Patch upload response:",
        data
      );

      throw new Error(
        "Patch uploaded, but the server did not return an image URL."
      );
    }

    return data.url;
  }


  // ---------------------------------------------------------
  // Render existing patches
  // ---------------------------------------------------------

  function renderPatches() {
    if (!patchesListEl) {
      return;
    }

    if (
      !patchesCache.length
    ) {
      patchesListEl.innerHTML = `
        <p class="admin-help-text">
          No patches uploaded yet.
        </p>
      `;

      return;
    }

    patchesListEl.innerHTML =
      patchesCache
        .map((p) => {
          const id =
            patchEscapeHtml(
              p.id || ""
            );

          const name =
            patchEscapeHtml(
              p.name ||
                "Unnamed Patch"
            );

          const isActive =
            p.active !== false;

          const imgSrc =
            patchEscapeHtml(
              cacheBust(
                toAbsoluteUrl(
                  p.imageUrl
                )
              )
            );

          const width =
            patchFixed(
              p.widthInches,
              3,
              2
            );

          const height =
            patchFixed(
              p.heightInches,
              2,
              2
            );

          // -----------------------------------------
          // CENTER preview adjustment
          // -----------------------------------------

          const centerScalePercent =
            Math.round(
              patchNumber(
                p.previewCenterScale,
                1
              ) * 100
            );

          const centerOffsetX =
            patchNumber(
              p.previewCenterOffsetX,
              0
            );

          const centerOffsetY =
            patchNumber(
              p.previewCenterOffsetY,
              0
            );


          // -----------------------------------------
          // LEFT preview adjustment
          // -----------------------------------------

          const leftScalePercent =
            Math.round(
              patchNumber(
                p.previewLeftScale,
                1
              ) * 100
            );

          const leftOffsetX =
            patchNumber(
              p.previewLeftOffsetX,
              0
            );

          const leftOffsetY =
            patchNumber(
              p.previewLeftOffsetY,
              0
            );


          // -----------------------------------------
          // RIGHT preview adjustment
          // -----------------------------------------

          const rightScalePercent =
            Math.round(
              patchNumber(
                p.previewRightScale,
                1
              ) * 100
            );

          const rightOffsetX =
            patchNumber(
              p.previewRightOffsetX,
              0
            );

          const rightOffsetY =
            patchNumber(
              p.previewRightOffsetY,
              0
            );

          return `
            <div
              class="patch-card"
              data-id="${id}"
              style="
                display:flex;
                flex-direction:column;
                gap:0.85rem;
              "
            >

              <!-- Artwork -->
              <div
                style="
                  min-height:150px;
                  display:flex;
                  align-items:center;
                  justify-content:center;
                  padding:0.75rem;
                  border-radius:12px;
                  background:
                    linear-gradient(
                      45deg,
                      #eeeeee 25%,
                      transparent 25%
                    ),
                    linear-gradient(
                      -45deg,
                      #eeeeee 25%,
                      transparent 25%
                    ),
                    linear-gradient(
                      45deg,
                      transparent 75%,
                      #eeeeee 75%
                    ),
                    linear-gradient(
                      -45deg,
                      transparent 75%,
                      #eeeeee 75%
                    );
                  background-size:
                    20px 20px;
                  background-position:
                    0 0,
                    0 10px,
                    10px -10px,
                    -10px 0px;
                "
              >
                <img
                  src="${imgSrc}"
                  alt="${name}"
                  style="
                    display:block;
                    width:auto;
                    height:auto;
                    max-width:100%;
                    max-height:160px;
                    object-fit:contain;
                  "
                />
              </div>


              <!-- Name -->
              <div>
                <label
                  class="admin-label"
                >
                  Patch Name
                </label>

                <input
                  type="text"
                  class="
                    admin-input
                    patch-edit-name
                  "
                  value="${name}"
                />
              </div>


              <fieldset class="patch-edit-categories"><legend>Patch Categories — choose any that apply</legend>${patchCategoryChecks(p.categories || [])}</fieldset>
              <fieldset class="patch-pricing-fields"><legend>Customer Pricing</legend><div class="field-grid">
                <label>Customer patch price ($)<input type="number" class="patch-edit-price" min="0" max="1000" step="0.01" value="${priceField(p.customerPriceCents)}" placeholder="Use default patch price"></label>
                <label>Attachment charge ($)<input type="number" class="patch-edit-attachment" min="0" max="1000" step="0.01" value="${priceField(p.attachmentFeeCents)}" placeholder="Use default attachment charge"></label>
              </div><p class="admin-help-text">Leave blank to use the defaults above. Enter 0 for no charge. These amounts are added to the selected hat’s Square price.</p></fieldset>
              <details class="patch-colors-details" open><summary>Colors, Materials & Availability</summary><p class="admin-help-text">Color price → design price → default price. Blank attachment fields follow the same order. Upload a finished photo for each color to update the customer preview.</p><div class="patch-colors">${(p.variants?.length?p.variants:[{id:'default',name:'Default',imageUrl:p.imageUrl,stockStatus:'in-stock'}]).map(patchColorRow).join('')}</div><button type="button" class="option-add secondary">Add Color / Material</button></details>
              <!-- Actual physical dimensions -->
              <div
                style="
                  display:grid;
                  grid-template-columns:
                    repeat(
                      auto-fit,
                      minmax(
                        120px,
                        1fr
                      )
                    );
                  gap:0.75rem;
                "
              >
                <div>
                  <label
                    class="admin-label"
                  >
                    Width (in)
                  </label>

                  <input
                    type="number"
                    class="
                      admin-input
                      patch-edit-width
                    "
                    min="0.25"
                    max="10"
                    step="0.01"
                    value="${width}"
                  />
                </div>

                <div>
                  <label
                    class="admin-label"
                  >
                    Height (in)
                  </label>

                  <input
                    type="number"
                    class="
                      admin-input
                      patch-edit-height
                    "
                    min="0.25"
                    max="10"
                    step="0.01"
                    value="${height}"
                  />
                </div>
              </div>


              <!-- Active -->
              <label
                class="admin-checkbox"
                style="
                  justify-content:center;
                "
              >
                <input
                  type="checkbox"
                  class="
                    patch-active-toggle
                  "
                  ${
                    isActive
                      ? "checked"
                      : ""
                  }
                />

                <span>
                  Active — show to customers
                </span>
              </label>


              <!-- Replace artwork -->
              <div>
                <label
                  class="admin-label"
                >
                  Replace Artwork
                </label>

                <input
                  type="file"
                  class="
                    admin-input
                    patch-replace-image
                  "
                  accept="
                    image/png,
                    image/jpeg,
                    image/webp,
                    image/gif
                  "
                />

                <button
                  type="button"
                  class="
                    btn-secondary
                    patch-replace-btn
                  "
                  style="
                    width:100%;
                    margin-top:0.5rem;
                  "
                >
                  Replace Image
                </button>
              </div>


              <!-- Preview adjustments -->
              <details
                class="
                  patch-preview-settings
                "
                style="
                  border-top:
                    1px solid
                    rgba(0,0,0,0.12);
                  padding-top:0.75rem;
                "
              >
                <summary
                  style="
                    cursor:pointer;
                    font-weight:700;
                  "
                >
                  Preview Adjustment
                </summary>

                <p
                  class="
                    admin-help-text
                    small
                  "
                  style="
                    margin-top:0.75rem;
                  "
                >
                  Fine-tune how this patch appears
                  for each placement. These settings
                  only affect the website preview.
                  They do not change the actual
                  physical patch dimensions.
                </p>


                <!-- =========================
                     CENTER
                     ========================= -->

                <div
                  style="
                    margin-top:1rem;
                    padding:0.85rem;
                    border:1px solid
                      rgba(0,0,0,0.12);
                    border-radius:10px;
                  "
                >
                  <div
                    style="
                      font-weight:700;
                      margin-bottom:0.65rem;
                    "
                  >
                    CENTER
                  </div>

                  <div
                    style="
                      display:grid;
                      grid-template-columns:
                        repeat(
                          auto-fit,
                          minmax(
                            110px,
                            1fr
                          )
                        );
                      gap:0.75rem;
                    "
                  >
                    <div>
                      <label
                        class="admin-label"
                      >
                        Size (%)
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-center-scale
                        "
                        min="25"
                        max="300"
                        step="1"
                        value="${centerScalePercent}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Left / Right
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-center-offset-x
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${centerOffsetX}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Up / Down
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-center-offset-y
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${centerOffsetY}"
                      />
                    </div>
                  </div>
                </div>


                <!-- =========================
                     LEFT
                     ========================= -->

                <div
                  style="
                    margin-top:0.75rem;
                    padding:0.85rem;
                    border:1px solid
                      rgba(0,0,0,0.12);
                    border-radius:10px;
                  "
                >
                  <div
                    style="
                      font-weight:700;
                      margin-bottom:0.65rem;
                    "
                  >
                    LEFT
                  </div>

                  <div
                    style="
                      display:grid;
                      grid-template-columns:
                        repeat(
                          auto-fit,
                          minmax(
                            110px,
                            1fr
                          )
                        );
                      gap:0.75rem;
                    "
                  >
                    <div>
                      <label
                        class="admin-label"
                      >
                        Size (%)
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-left-scale
                        "
                        min="25"
                        max="300"
                        step="1"
                        value="${leftScalePercent}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Left / Right
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-left-offset-x
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${leftOffsetX}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Up / Down
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-left-offset-y
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${leftOffsetY}"
                      />
                    </div>
                  </div>
                </div>


                <!-- =========================
                     RIGHT
                     ========================= -->

                <div
                  style="
                    margin-top:0.75rem;
                    padding:0.85rem;
                    border:1px solid
                      rgba(0,0,0,0.12);
                    border-radius:10px;
                  "
                >
                  <div
                    style="
                      font-weight:700;
                      margin-bottom:0.65rem;
                    "
                  >
                    RIGHT
                  </div>

                  <div
                    style="
                      display:grid;
                      grid-template-columns:
                        repeat(
                          auto-fit,
                          minmax(
                            110px,
                            1fr
                          )
                        );
                      gap:0.75rem;
                    "
                  >
                    <div>
                      <label
                        class="admin-label"
                      >
                        Size (%)
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-right-scale
                        "
                        min="25"
                        max="300"
                        step="1"
                        value="${rightScalePercent}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Left / Right
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-right-offset-x
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${rightOffsetX}"
                      />
                    </div>

                    <div>
                      <label
                        class="admin-label"
                      >
                        Up / Down
                      </label>

                      <input
                        type="number"
                        class="
                          admin-input
                          patch-edit-right-offset-y
                        "
                        min="-100"
                        max="100"
                        step="1"
                        value="${rightOffsetY}"
                      />
                    </div>
                  </div>
                </div>

              </details>


              <!-- Actions -->
              <div
                class="patch-actions"
                style="
                  display:grid;
                  grid-template-columns:
                    1fr 1fr;
                  gap:0.6rem;
                "
              >
                <button
                  type="button"
                  class="
                    btn-primary
                    patch-save-btn
                  "
                >
                  Save Changes
                </button>

                <button
                  type="button"
                  class="
                    btn-danger
                    patch-delete-btn
                  "
                >
                  Delete
                </button>
              </div>

              <p
                class="
                  admin-status
                  patch-card-status
                "
                style="margin:0;"
              ></p>
            </div>
          `;
        })
        .join("");
    window.BrackishHatPreviewAdmin?.wire(patchesListEl,patchesCache);
    filterPatchCards();
  }


  // ---------------------------------------------------------
  // Load Patch Manager
  // ---------------------------------------------------------

  async function loadPatchesUI() {
    if (!patchesListEl) {
      return;
    }

    showPatchStatus(
      patchesStatusEl,
      "Loading patches…"
    );

    try {
      await loadMaterials();
      patchesCache =
        await fetchAdminPatches();

      renderPatches();

      showPatchStatus(
        patchesStatusEl,
        `Patches loaded. (${patchesCache.length})`
      );
    } catch (err) {
      console.error(err);

      showPatchStatus(
        patchesStatusEl,
        err?.message ||
          "Error loading patches.",
        true
      );
    }
  }


  // ---------------------------------------------------------
  // Add new patch
  // ---------------------------------------------------------

  async function addPatch(
    name,
    widthInches,
    heightInches,
    active,
    file
  ) {
    showPatchStatus(
      patchUploadStatusEl,
      "Uploading image…"
    );

    const imageUrl =
      await uploadPatchImage(
        file
      );

    showPatchStatus(
      patchUploadStatusEl,
      "Saving patch…"
    );

    const now =
      new Date().toISOString();

    const newPatch = {
      id:
        window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()),

      name,
      customerPriceCents: readPatchDollars(document.getElementById("patchCustomerPrice"),"Customer patch price"),
      attachmentFeeCents: readPatchDollars(document.getElementById("patchAttachmentFee"),"Attachment charge"),
      categories: Array.from(document.querySelectorAll("#patch-new-categories input:checked"), n => n.value),
      imageUrl,

      widthInches,
      heightInches,

      // CENTER preview defaults

      previewCenterScale: 1,
      previewCenterOffsetX: 0,
      previewCenterOffsetY: 0,


      // LEFT preview defaults

      previewLeftScale: 1,
      previewLeftOffsetX: 0,
      previewLeftOffsetY: 0,


      // RIGHT preview defaults

      previewRightScale: 1,
      previewRightOffsetX: 0,
      previewRightOffsetY: 0,

      active: !!active,

      createdAt: now,
      updatedAt: now,
    };

    const next = [
      newPatch,
      ...patchesCache,
    ];

    patchesCache =
      await saveAdminPatches(
        next
      );

    renderPatches();

    showPatchStatus(
      patchUploadStatusEl,
      "Patch added!"
    );
  }


  // ---------------------------------------------------------
  // Read editable card values
  // ---------------------------------------------------------

  function getPatchCardValues(
    card
  ) {
    if (!card) {
      return null;
    }


    // -------------------------------------------------------
    // Basic patch information
    // -------------------------------------------------------

    const nameEl =
      card.querySelector(
        ".patch-edit-name"
      );

    const widthEl =
      card.querySelector(
        ".patch-edit-width"
      );

    const heightEl =
      card.querySelector(
        ".patch-edit-height"
      );

    const activeEl =
      card.querySelector(
        ".patch-active-toggle"
      );


    // -------------------------------------------------------
    // CENTER preview controls
    // -------------------------------------------------------

    const centerScaleEl =
      card.querySelector(
        ".patch-edit-center-scale"
      );

    const centerOffsetXEl =
      card.querySelector(
        ".patch-edit-center-offset-x"
      );

    const centerOffsetYEl =
      card.querySelector(
        ".patch-edit-center-offset-y"
      );


    // -------------------------------------------------------
    // LEFT preview controls
    // -------------------------------------------------------

    const leftScaleEl =
      card.querySelector(
        ".patch-edit-left-scale"
      );

    const leftOffsetXEl =
      card.querySelector(
        ".patch-edit-left-offset-x"
      );

    const leftOffsetYEl =
      card.querySelector(
        ".patch-edit-left-offset-y"
      );


    // -------------------------------------------------------
    // RIGHT preview controls
    // -------------------------------------------------------

    const rightScaleEl =
      card.querySelector(
        ".patch-edit-right-scale"
      );

    const rightOffsetXEl =
      card.querySelector(
        ".patch-edit-right-offset-x"
      );

    const rightOffsetYEl =
      card.querySelector(
        ".patch-edit-right-offset-y"
      );


    // -------------------------------------------------------
    // Read values
    // -------------------------------------------------------

    const name =
      (
        nameEl?.value || ""
      ).trim();

    const widthInches =
      Number(
        widthEl?.value
      );

    const heightInches =
      Number(
        heightEl?.value
      );


    // CENTER

    const centerScalePercent =
      Number(
        centerScaleEl?.value
      );

    const previewCenterOffsetX =
      Number(
        centerOffsetXEl?.value
      );

    const previewCenterOffsetY =
      Number(
        centerOffsetYEl?.value
      );


    // LEFT

    const leftScalePercent =
      Number(
        leftScaleEl?.value
      );

    const previewLeftOffsetX =
      Number(
        leftOffsetXEl?.value
      );

    const previewLeftOffsetY =
      Number(
        leftOffsetYEl?.value
      );


    // RIGHT

    const rightScalePercent =
      Number(
        rightScaleEl?.value
      );

    const previewRightOffsetX =
      Number(
        rightOffsetXEl?.value
      );

    const previewRightOffsetY =
      Number(
        rightOffsetYEl?.value
      );


    // -------------------------------------------------------
    // Validation
    // -------------------------------------------------------

    if (!name) {
      throw new Error(
        "Patch name is required."
      );
    }


    if (
      !Number.isFinite(
        widthInches
      ) ||
      widthInches < 0.25 ||
      widthInches > 10
    ) {
      throw new Error(
        "Width must be between 0.25 and 10 inches."
      );
    }


    if (
      !Number.isFinite(
        heightInches
      ) ||
      heightInches < 0.25 ||
      heightInches > 10
    ) {
      throw new Error(
        "Height must be between 0.25 and 10 inches."
      );
    }


    // CENTER validation

    if (
      !Number.isFinite(
        centerScalePercent
      ) ||
      centerScalePercent < 25 ||
      centerScalePercent > 300
    ) {
      throw new Error(
        "Center preview size must be between 25% and 300%."
      );
    }

    if (
      !Number.isFinite(
        previewCenterOffsetX
      ) ||
      previewCenterOffsetX < -100 ||
      previewCenterOffsetX > 100
    ) {
      throw new Error(
        "Center Left / Right adjustment must be between -100 and 100."
      );
    }

    if (
      !Number.isFinite(
        previewCenterOffsetY
      ) ||
      previewCenterOffsetY < -100 ||
      previewCenterOffsetY > 100
    ) {
      throw new Error(
        "Center Up / Down adjustment must be between -100 and 100."
      );
    }


    // LEFT validation

    if (
      !Number.isFinite(
        leftScalePercent
      ) ||
      leftScalePercent < 25 ||
      leftScalePercent > 300
    ) {
      throw new Error(
        "Left preview size must be between 25% and 300%."
      );
    }

    if (
      !Number.isFinite(
        previewLeftOffsetX
      ) ||
      previewLeftOffsetX < -100 ||
      previewLeftOffsetX > 100
    ) {
      throw new Error(
        "Left Left / Right adjustment must be between -100 and 100."
      );
    }

    if (
      !Number.isFinite(
        previewLeftOffsetY
      ) ||
      previewLeftOffsetY < -100 ||
      previewLeftOffsetY > 100
    ) {
      throw new Error(
        "Left Up / Down adjustment must be between -100 and 100."
      );
    }


    // RIGHT validation

    if (
      !Number.isFinite(
        rightScalePercent
      ) ||
      rightScalePercent < 25 ||
      rightScalePercent > 300
    ) {
      throw new Error(
        "Right preview size must be between 25% and 300%."
      );
    }

    if (
      !Number.isFinite(
        previewRightOffsetX
      ) ||
      previewRightOffsetX < -100 ||
      previewRightOffsetX > 100
    ) {
      throw new Error(
        "Right Left / Right adjustment must be between -100 and 100."
      );
    }

    if (
      !Number.isFinite(
        previewRightOffsetY
      ) ||
      previewRightOffsetY < -100 ||
      previewRightOffsetY > 100
    ) {
      throw new Error(
        "Right Up / Down adjustment must be between -100 and 100."
      );
    }


    // -------------------------------------------------------
    // Return normalized patch values
    // -------------------------------------------------------

    return {
      name,
      variants:readPatchColors(card),
      customerPriceCents: readPatchDollars(card.querySelector(".patch-edit-price"),"Customer patch price"),
      attachmentFeeCents: readPatchDollars(card.querySelector(".patch-edit-attachment"),"Attachment charge"),
      categories: Array.from(card.querySelectorAll(".patch-edit-categories input:checked"), n => n.value),

      widthInches,
      heightInches,


      // CENTER
      // Backend stores 1.00 = 100%

      previewCenterScale:
        centerScalePercent / 100,

      previewCenterOffsetX,
      previewCenterOffsetY,


      // LEFT

      previewLeftScale:
        leftScalePercent / 100,

      previewLeftOffsetX,
      previewLeftOffsetY,


      // RIGHT

      previewRightScale:
        rightScalePercent / 100,

      previewRightOffsetX,
      previewRightOffsetY,


      active:
        activeEl
          ? activeEl.checked
          : true,
    };
  }

  // ---------------------------------------------------------
  // Save existing patch changes
  // ---------------------------------------------------------

  async function savePatchCard(
    card
  ) {
    if (!card) return;

    const id =
      card.dataset.id;

    if (!id) return;

    const statusEl =
      card.querySelector(
        ".patch-card-status"
      );

    try {
      const values =
        getPatchCardValues(
          card
        );

      showPatchStatus(
        statusEl,
        "Saving…"
      );

      const next =
        patchesCache.map(
          (p) => {
            if (
              p.id !== id
            ) {
              return p;
            }

            return {
              ...p,
              ...values,

              updatedAt:
                new Date()
                  .toISOString(),
            };
          }
        );

      patchesCache =
        await saveAdminPatches(
          next
        );

      // Keep other cards mounted so their pending prices, dimensions, and file selections survive this save.
      const pendingCards=Array.from(patchesListEl.querySelectorAll('.patch-card')).filter(other=>other.dataset.id!==id);
      await loadMaterials();
      renderPatches();
      for(const other of pendingCards){const fresh=patchesListEl.querySelector(`.patch-card[data-id="${CSS.escape(other.dataset.id)}"]`);fresh?.replaceWith(other);}
      window.BrackishHatPreviewAdmin?.wire(patchesListEl,patchesCache);
    filterPatchCards();

      const refreshedCard =
        patchesListEl?.querySelector(
          `.patch-card[data-id="${CSS.escape(
            id
          )}"]`
        );

      const refreshedStatus =
        refreshedCard?.querySelector(
          ".patch-card-status"
        );

      showPatchStatus(
        refreshedStatus,
        "Changes saved."
      );
    } catch (err) {
      console.error(err);

      showPatchStatus(
        statusEl,
        err?.message ||
          "Failed to save changes.",
        true
      );
    }
  }


  // ---------------------------------------------------------
  // Replace existing patch artwork
  // ---------------------------------------------------------

  async function replacePatchImage(
    card
  ) {
    if (!card) return;

    const id =
      card.dataset.id;

    if (!id) return;

    const fileInput =
      card.querySelector(
        ".patch-replace-image"
      );

    const statusEl =
      card.querySelector(
        ".patch-card-status"
      );

    const file =
      fileInput?.files?.[0] ||
      null;

    if (!file) {
      showPatchStatus(
        statusEl,
        "Choose a replacement image first.",
        true
      );

      return;
    }

    try {
      /*
        Read current edits first so replacing
        the image does not discard changes
        made to the same patch card.
      */
      const values =
        getPatchCardValues(
          card
        );

      showPatchStatus(
        statusEl,
        "Uploading replacement image…"
      );

      const newImageUrl =
        await uploadPatchImage(
          file
        );

      showPatchStatus(
        statusEl,
        "Saving replacement…"
      );

      const next =
        patchesCache.map(
          (p) => {
            if (
              p.id !== id
            ) {
              return p;
            }

            return {
              ...p,
              ...values,

              imageUrl:
                newImageUrl,

              updatedAt:
                new Date()
                  .toISOString(),
            };
          }
        );

      patchesCache =
        await saveAdminPatches(
          next
        );

      renderPatches();

      const refreshedCard =
        patchesListEl?.querySelector(
          `.patch-card[data-id="${CSS.escape(
            id
          )}"]`
        );

      const refreshedStatus =
        refreshedCard?.querySelector(
          ".patch-card-status"
        );

      showPatchStatus(
        refreshedStatus,
        "Image replaced."
      );
    } catch (err) {
      console.error(err);

      showPatchStatus(
        statusEl,
        err?.message ||
          "Failed to replace image.",
        true
      );
    }
  }


  // ---------------------------------------------------------
  // Delete patch
  // ---------------------------------------------------------

  async function deletePatch(id) {
    if (!id) return;

    if (
      !window.confirm(
        "Delete this patch? This removes it from the Patch Manager and customer Hat Builder."
      )
    ) {
      return;
    }

    showPatchStatus(
      patchesStatusEl,
      "Deleting…"
    );

    try {
      const next =
        patchesCache.filter(
          (p) =>
            p.id !== id
        );

      patchesCache =
        await saveAdminPatches(
          next
        );

      renderPatches();

      showPatchStatus(
        patchesStatusEl,
        "Patch deleted."
      );
    } catch (err) {
      console.error(err);

      showPatchStatus(
        patchesStatusEl,
        err?.message ||
          "Delete failed.",
        true
      );
    }
  }


  // ---------------------------------------------------------
  // Add-new-patch form
  // ---------------------------------------------------------

  if (patchUploadForm) {
    patchUploadForm.addEventListener(
      "submit",
      async (e) => {
        e.preventDefault();

        const name =
          (
            patchNameInput?.value ||
            ""
          ).trim();

        const widthInches =
          Number(
            patchWidthInput?.value
          );

        const heightInches =
          Number(
            patchHeightInput?.value
          );

        const file =
          patchImageInput
            ?.files?.[0] ||
          null;

        const active =
          patchActiveInput
            ? patchActiveInput.checked
            : true;

        if (!name) {
          showPatchStatus(
            patchUploadStatusEl,
            "Patch name is required.",
            true
          );

          return;
        }

        if (
          !Number.isFinite(
            widthInches
          ) ||
          widthInches < 0.25 ||
          widthInches > 10
        ) {
          showPatchStatus(
            patchUploadStatusEl,
            "Enter a valid patch width between 0.25 and 10 inches.",
            true
          );

          return;
        }

        if (
          !Number.isFinite(
            heightInches
          ) ||
          heightInches < 0.25 ||
          heightInches > 10
        ) {
          showPatchStatus(
            patchUploadStatusEl,
            "Enter a valid patch height between 0.25 and 10 inches.",
            true
          );

          return;
        }

        if (!file) {
          showPatchStatus(
            patchUploadStatusEl,
            "Patch image is required.",
            true
          );

          return;
        }

        try {
          readPatchDollars(document.getElementById("patchCustomerPrice"),"Customer patch price");
          readPatchDollars(document.getElementById("patchAttachmentFee"),"Attachment charge");
          await addPatch(
            name,
            widthInches,
            heightInches,
            active,
            file
          );

          if (
            patchNameInput
          ) {
            patchNameInput.value =
              "";
          }

          if (
            patchWidthInput
          ) {
            patchWidthInput.value =
              "3.00";
          }

          if (
            patchHeightInput
          ) {
            patchHeightInput.value =
              "2.00";
          }

          if (
            patchActiveInput
          ) {
            patchActiveInput.checked =
              true;
          }

          if (
            patchImageInput
          ) {
            patchImageInput.value =
              "";
          }

          /*
            Reload from server so we verify
            the physical dimensions and all
            patch metadata actually persisted.
          */
          document.getElementById("patchCustomerPrice").value="";
          document.getElementById("patchAttachmentFee").value="";
          patchUploadForm.dataset.dirty="";
          await loadPatchesUI();
        } catch (err) {
          console.error(err);

          showPatchStatus(
            patchUploadStatusEl,
            err?.message ||
              "Failed to add patch.",
            true
          );
        }
      }
    );
  }


  // ---------------------------------------------------------
  // Existing patch actions
  // ---------------------------------------------------------

  if (patchesListEl) {
    patchesListEl.addEventListener(
      "click",
      async (e) => {
        const target =
          e.target;

        if (
          !(
            target instanceof
            HTMLElement
          )
        ) {
          return;
        }

        const card =
          target.closest(
            ".patch-card"
          );

        if (!card) {
          return;
        }


        // Save edits
        if (
          target.closest(
            ".patch-save-btn"
          )
        ) {
          await savePatchCard(
            card
          );

          return;
        }


        // Replace artwork
        if (
          target.closest(
            ".patch-replace-btn"
          )
        ) {
          await replacePatchImage(
            card
          );

          return;
        }


        // Delete
        if (
          target.closest(
            ".patch-delete-btn"
          )
        ) {
          await deletePatch(
            card.dataset.id
          );

          return;
        }
      }
    );
  }


  // ---------------------------------------------------------
  // Expand / collapse Patch Manager
  // ---------------------------------------------------------

  if (
    patchesToggleBtn &&
    patchesSection
  ) {
    patchesSection.classList.add(
      "patches-collapsed"
    );

    patchesToggleBtn.textContent =
      "Expand Patches";

    patchesToggleBtn.addEventListener(
      "click",
      async () => {
        const collapsed =
          patchesSection.classList.toggle(
            "patches-collapsed"
          );

        patchesToggleBtn.textContent =
          collapsed
            ? "Expand Patches"
            : "Collapse Patches";

        if (!collapsed) {
          await loadPatchesUI();
        }
      }
    );
  }


  // ---------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------

  if (!document.body.classList.contains("business-admin")) loadPatchesUI().catch(
    () => {}
  );
  // =======================
  //  ELEMENT REFERENCES
  // =======================

  // --- Banner + popup ---
  const bannerForm = document.getElementById("banner-form");
  const bannerTextInput = document.getElementById("bannerText");
  const bannerVisibleCheckbox = document.getElementById("bannerVisible");
  const bannerStatusEl = document.getElementById("banner-status");

  // New popup controls (shop splash)
  const popupEnabledCheckbox = document.getElementById("popupEnabled");
  const popupModeSelect = document.getElementById("popupMode");
  const popupCustomTextInput = document.getElementById("popupCustomText");
  const popupStatusEl = document.getElementById("popup-status") || bannerStatusEl;

  // --- Shipping settings ---
  const shippingFlatRateInput = document.getElementById("shippingFlatRate");
  const freeShippingThresholdInput = document.getElementById("freeShippingThreshold");
  const shippingStatusEl = document.getElementById("shipping-status");

  // --- Orders table + section ---
  const refreshOrdersBtn = document.getElementById("refresh-orders");
  const ordersTbody = document.getElementById("orders-tbody");
  const ordersSection = document.getElementById("orders-section");
  const ordersToggleBtn = document.getElementById("orders-toggle-btn");

  // --- Archive download ---
  const archiveBtn = document.getElementById("archive-current-month");
  const archiveStatusEl = document.getElementById("archive-status");

  // --- Products / inventory flags ---
  const flagsTbody =
    document.getElementById("flags-tbody") || document.getElementById("products-tbody");
  const flagsStatusEl =
    document.getElementById("flags-status") || document.getElementById("products-status");
  const saveFlagsBtn =
    document.getElementById("save-flags-btn") || document.getElementById("save-products");
  const flagsSection = document.getElementById("flags-section");
  const flagsToggleBtn = document.getElementById("flags-toggle-btn");
  const flagsSearchInput = document.getElementById("flags-search");
  const flagsSubcatFilter = document.getElementById("flags-filter-subcat");

  // --- Catalog / Inventory sync buttons ---
  const syncCatalogBtn = document.getElementById("btn-sync-catalog");
  const syncInventoryBtn = document.getElementById("btn-sync-inventory");
  const syncStatusEl = document.getElementById("sync-status");

  // --- Barcode / Inventory Management section + controls ---
  const barcodeSection = document.getElementById("barcode-section");
  const barcodeToggleBtn = document.getElementById("barcode-toggle-btn");
  const barcodeSearchInput = document.getElementById("barcode-search");
  const barcodeSubcatFilter = document.getElementById("barcode-filter-subcat");
  const barcodeShowZeroCheckbox = document.getElementById("barcode-show-zero");
  const barcodeRefreshBtn = document.getElementById("barcode-refresh-btn");
  const barcodePrintSelectedBtn = document.getElementById("barcode-print-selected-btn");
  const barcodeStatusEl = document.getElementById("barcode-status");
  const barcodeProductsContainer = document.getElementById("barcode-products-container");

  // Dedicated scan display/input box at top of barcode section (optional)
  const barcodeScanInput = document.getElementById("barcode-scan-input");

  // Output mode checkbox
  const barcodePrintToLabelCheckbox = document.getElementById("barcode-print-to-label");
  // (kept for compatibility; not used right now)
  const barcodeDownloadPdfCheckbox = document.getElementById("barcode-download-pdf");

  const barcodeApplyInventoryBtn = document.getElementById("barcode-apply-inventory-btn");

  // ===================== INACTIVITY AUTO-LOGOUT =====================
  const INACTIVITY_DEFAULT_MS = 15 * 60 * 1000; // 15 minutes
  const INACTIVITY_EXTENDED_MS = 4 * 60 * 60 * 1000; // 4 hours

  const timeoutToggle = document.getElementById("extend-timeout-toggle");
  let inactivityTimerId = null;

  function getCurrentTimeoutDuration() {
    if (timeoutToggle && timeoutToggle.checked) return INACTIVITY_EXTENDED_MS;
    return INACTIVITY_DEFAULT_MS;
  }

  function scheduleInactivityLogout() {
    if (inactivityTimerId) clearTimeout(inactivityTimerId);
    inactivityTimerId = setTimeout(handleInactivityLogout, getCurrentTimeoutDuration());
  }

  async function handleInactivityLogout() {
    try {
      await adminFetch("/admin/logout", { method: "POST" });
    } catch (err) {
      console.error("Auto-logout request failed:", err);
    } finally {
      window.location.href = "/admin-login";
    }
  }

  ["click", "keydown", "mousemove", "scroll", "touchstart", "touchmove"].forEach((evt) => {
    window.addEventListener(evt, scheduleInactivityLogout, { passive: true });
  });

  if (timeoutToggle) {
    timeoutToggle.addEventListener("change", scheduleInactivityLogout);
  }

  // =======================
  //  DATA STORES
  // =======================

  // Latest products from /admin/products
  let adminProducts = [];

  // Latest products from /admin/barcode-products
  let barcodeProductsRaw = [];

  // Scan-based counted qty per SKU (delta to send to Square)
  const scanCountsBySku = {};

  // Persist “selected for label print” across searching/filtering/re-render
  const selectedBarcodeSkus = new Set();

  // Persist “labels to print” qty per SKU across searching/filtering/re-render
  const labelQtyBySku = {};

  // Quick lookup: scanned code (barcode or SKU) -> canonical SKU
  let scanSkuIndex = {};

  function rebuildScanSkuIndex() {
    scanSkuIndex = {};
    (barcodeProductsRaw || []).forEach((p) => {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      vars.forEach((v) => {
        if (!v) return;
        const sku = v.sku || "";
        if (sku) scanSkuIndex[sku] = sku;

        // If backend ever gives a separate barcode/UPC, map that too
        const barcode = v.barcode || v.upc || v.barcodeValue;
        if (barcode) scanSkuIndex[barcode] = sku || barcode;
      });
    });
  }

  function resolveSkuFromScan(codeRaw) {
    const raw = (codeRaw || "").trim();
    if (!raw) return null;

    if (!barcodeProductsRaw || !barcodeProductsRaw.length) return null;

    if (scanSkuIndex[raw]) return scanSkuIndex[raw];

    for (const p of barcodeProductsRaw) {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      for (const v of vars) {
        if (v && typeof v.sku === "string" && v.sku === raw) return v.sku;
      }
    }
    return null;
  }

  // =======================
  //  HELPERS
  // =======================
  function showStatus(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#a23b32" : "#256044";
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function playScanBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if (ctx.state === "suspended" && ctx.resume) {
        ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close().catch(() => {});
      }, 80);
    } catch (_) {}
  }

  // Find a variant by SKU in barcodeProductsRaw
  function findVariantBySku(sku) {
    const rawSku = (sku || "").trim();
    if (!rawSku) return null;

    for (const p of barcodeProductsRaw || []) {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      for (const v of vars) {
        if (v && String(v.sku || "").trim() === rawSku) {
          return { product: p, variant: v };
        }
      }
    }
    return null;
  }

  // Ensure row is visible (expand variants) + scroll to it
  function scrollAndRevealSkuRow(sku) {
    if (!barcodeProductsContainer || !sku) return;

    const selectorSku =
      typeof CSS !== "undefined" && CSS.escape
        ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
        : `.barcode-variant-row[data-sku="${sku}"]`;

    const row = barcodeProductsContainer.querySelector(selectorSku);
    if (!row) return;

    // Ensure variants container visible
    const productEl = row.closest(".barcode-product");
    if (productEl) {
      const variantsEl = productEl.querySelector(".barcode-variants");
      const toggleBtn = productEl.querySelector(".barcode-toggle");
      if (variantsEl) {
        const isHidden =
          variantsEl.style.display === "none" ||
          getComputedStyle(variantsEl).display === "none";

        if (isHidden) {
          variantsEl.style.display = "";
          if (toggleBtn) toggleBtn.textContent = "▾";
        }
      }
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Persistent highlighting:
  // - previous last becomes seen
  // - current becomes last
  function markRowAsLastScanned(row) {
    if (!barcodeProductsContainer || !row) return;

    const prevLast = barcodeProductsContainer.querySelector(
      ".barcode-variant-row.scan-last"
    );

    if (prevLast && prevLast !== row) {
      prevLast.classList.remove("scan-last");
      prevLast.classList.add("scan-seen");
    }

    row.classList.add("scan-last");
    row.classList.remove("scan-seen");
  }

  // Apply scanCountsBySku to any rendered rows
  function applyScanCountsToDom() {
    if (!barcodeProductsContainer) return;

    const rows = barcodeProductsContainer.querySelectorAll(".barcode-variant-row");
    rows.forEach((row) => {
      const sku = row.getAttribute("data-sku");
      if (!sku) return;

      const val = scanCountsBySku[sku];
      if (typeof val === "number" && Number.isFinite(val) && val !== 0) {
        const input = row.querySelector(".inv-count-input");
        if (input) input.value = String(val);
      }
    });
  }

  // Increment in-memory count for a SKU and update row if visible
  function bumpScanCountForSku(sku) {
    if (!sku) return 0;

    const current = Number(scanCountsBySku[sku] || 0);
    const nextVal = Number.isFinite(current) ? current + 1 : 1;
    scanCountsBySku[sku] = nextVal;

    // If row exists now, update input and highlight
    if (barcodeProductsContainer) {
      const selectorSku =
        typeof CSS !== "undefined" && CSS.escape
          ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
          : `.barcode-variant-row[data-sku="${sku}"]`;

      const row = barcodeProductsContainer.querySelector(selectorSku);
      if (row) {
        const input = row.querySelector(".inv-count-input");
        if (input) input.value = String(nextVal);

        markRowAsLastScanned(row);
      }
    }

    // Always scroll/reveal if possible (after count update)
    scrollAndRevealSkuRow(sku);

    // Beep on successful scan
    playScanBeep();

    return nextVal;
  }

  // Helper: ensure row becomes renderable even if filters hide it
  function ensureRowVisibleThenScroll(sku) {
    if (!barcodeProductsContainer || !sku) return;

    const selectorSku =
      typeof CSS !== "undefined" && CSS.escape
        ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
        : `.barcode-variant-row[data-sku="${sku}"]`;

    const exists = !!barcodeProductsContainer.querySelector(selectorSku);
    if (exists) {
      scrollAndRevealSkuRow(sku);
      return;
    }

    // Clear filters so row can render
    if (barcodeSearchInput) barcodeSearchInput.value = "";
    if (barcodeSubcatFilter) barcodeSubcatFilter.value = "";
    if (barcodeShowZeroCheckbox) barcodeShowZeroCheckbox.checked = true;

    applyBarcodeFiltersAndRender();

    // Wait a tick for DOM to render, then scroll/highlight
    setTimeout(() => {
      scrollAndRevealSkuRow(sku);
      const row = barcodeProductsContainer.querySelector(selectorSku);
      if (row) markRowAsLastScanned(row);
    }, 50);
  }

  // =======================
  //  BANNER + POPUP + SHIPPING CONFIG
  // =======================
  async function loadBannerConfig() {
    if (!bannerTextInput || !bannerVisibleCheckbox) return;

    try {
      const res = await adminFetch("/admin/config");

      if (!res.ok) throw new Error("Failed to load banner config");

      const data = await res.json();

      bannerTextInput.value = data.bannerText || "";
      bannerVisibleCheckbox.checked = !!data.bannerVisible;

      if (popupEnabledCheckbox) popupEnabledCheckbox.checked = !!data.popupEnabled;
      if (popupModeSelect && typeof data.popupMode === "string") popupModeSelect.value = data.popupMode;
      if (popupCustomTextInput) popupCustomTextInput.value = data.popupCustomText || "";

      if (shippingFlatRateInput && data.shippingFlatRate != null) {
        shippingFlatRateInput.value = String(data.shippingFlatRate);
      }
      if (freeShippingThresholdInput && data.freeShippingThreshold != null) {
        freeShippingThresholdInput.value = String(data.freeShippingThreshold);
      }

      showStatus(bannerStatusEl, "Banner & popup loaded.", false);
      showStatus(shippingStatusEl, "Shipping settings loaded.", false);
    } catch (err) {
      console.error("Error loading banner config:", err);
      showStatus(bannerStatusEl, "Failed to load banner settings.", true);
      showStatus(shippingStatusEl, "Failed to load shipping settings.", true);
    }
  }

  async function saveBannerConfig(e) {
    e.preventDefault();
    if (!bannerTextInput || !bannerVisibleCheckbox) return;

    const payload = {
      bannerText: bannerTextInput.value || "",
      bannerVisible: bannerVisibleCheckbox.checked,
    };

    if (popupEnabledCheckbox) payload.popupEnabled = popupEnabledCheckbox.checked;
    if (popupModeSelect) payload.popupMode = popupModeSelect.value || "none";
    if (popupCustomTextInput) payload.popupCustomText = popupCustomTextInput.value || "";

    if (shippingFlatRateInput) {
      const v = parseFloat(shippingFlatRateInput.value);
      payload.shippingFlatRate = isNaN(v) ? 0 : v;
    }
    if (freeShippingThresholdInput) {
      const v = parseFloat(freeShippingThresholdInput.value);
      payload.freeShippingThreshold = isNaN(v) ? 0 : v;
    }

    showStatus(bannerStatusEl, "Saving...", false);
    showStatus(shippingStatusEl, "Saving shipping settings...", false);

    try {
      const res = await adminFetch("/admin/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save banner config");

      console.log("Saved banner/popup/shipping config:", data);
      bannerForm.dataset.dirty="";
      showStatus(bannerStatusEl, "Settings saved.", false);
      showStatus(popupStatusEl, "Popup settings saved.", false);
      showStatus(shippingStatusEl, "Shipping settings saved.", false);
    } catch (err) {
      console.error("Error saving banner config:", err);
      showStatus(bannerStatusEl, "Failed to save banner settings.", true);
      showStatus(popupStatusEl, "Failed to save popup settings.", true);
      showStatus(shippingStatusEl, "Failed to save shipping settings.", true);
    }
  }

  // =======================
  //  ORDERS TABLE
  // =======================
  function filterOrders() {
    const query=(document.getElementById('order-search')?.value||'').trim().toLowerCase(),status=document.getElementById('order-filter')?.value||'';let count=0;
    ordersTbody?.querySelectorAll('tr[data-order-id]').forEach(row=>{row.hidden=!!(query&&!row.dataset.search.includes(query)||status&&row.querySelector('.order-status-input').value!==status);if(!row.hidden)count++;});
    const target=document.getElementById('order-count');if(target)target.textContent=`${count} orders shown · latest 50`;
  }
  for(const id of ['order-search','order-filter'])document.getElementById(id)?.addEventListener('input',filterOrders);
  document.getElementById('order-detail-close')?.addEventListener('click',()=>document.getElementById('order-detail-dialog').close());
  function paymentLabel(order) {
    return ({PAID:'Paid',PARTIALLY_REFUNDED:'Partially refunded',REFUNDED:'Refunded',UNVERIFIED:'Payment needs verification',PENDING:'Awaiting payment'})[order.paymentStatus] || 'Payment needs verification';
  }
  function fulfillmentLabel(status) {
    return status==='PAID'?'Awaiting fulfillment':status==='REFUNDED'?'Closed after refund':String(status||'PENDING').replaceAll('_',' ');
  }
  function renderOrdersTable(orders) {
    if (!ordersTbody) return;

    if (!Array.isArray(orders) || orders.length === 0) {
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="7">No orders found.</td>
        </tr>
      `;
      return;
    }

    const rowsHtml = orders
      .map((order) => {
        const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString() : "-";
        const totalStr = typeof order.total === "number" ? `$${order.total.toFixed(2)}` : "-";
        const customerLabel = escapeHtml(order.customerName || order.customerEmail || "-");
        const statusValue = order.status || "PENDING";
        const trackingValue = order.trackingNumber || "";

        return `
          <tr data-order-id="${order.id}" data-search="${escapeHtml((order.id+' '+(order.customerName||'')+' '+(order.customerEmail||'')).toLowerCase())}">
            <td>${dateStr}</td>
            <td><strong>#${order.id} · ${customerLabel}</strong><span class="muted">${escapeHtml(order.customerEmail || "")}</span><button type="button" class="order-detail-btn secondary">View details</button></td>
            <td>${totalStr}<br><strong class="order-payment-state">${escapeHtml(paymentLabel(order))}</strong>${order.refundedCents?`<br><span class="muted">Refunded: ${(order.refundedCents/100).toFixed(2)}</span>`:""}</td>
            <td>
              <select class="order-status-input" aria-label="Fulfillment for order ${order.id}">
                <option value="PENDING" ${statusValue === "PENDING" ? "selected" : ""}>PENDING</option>
                <option value="AWAITING_PROOF" ${statusValue === "AWAITING_PROOF" ? "selected" : ""}>AWAITING PROOF</option>${statusValue === "PAID" ? '<option value="PAID" selected>Awaiting fulfillment</option>' : ""}
                <option value="IN_PRODUCTION" ${statusValue === "IN_PRODUCTION" ? "selected" : ""}>IN PRODUCTION</option><option value="READY" ${statusValue === "READY" ? "selected" : ""}>READY</option>${statusValue === "REFUNDED" ? '<option value="REFUNDED" selected>Closed after refund</option>' : ""}<option value="SHIPPED" ${statusValue === "SHIPPED" ? "selected" : ""}>SHIPPED</option>
                <option value="CANCELLED" ${statusValue === "CANCELLED" ? "selected" : ""}>CANCELLED</option>
                <option value="ARCHIVED" ${statusValue === "ARCHIVED" ? "selected" : ""}>ARCHIVED</option>
              </select>
            </td>
            <td>
              <input
                type="text"
                class="order-tracking-input"
                placeholder="Tracking #"
                value="${escapeHtml(trackingValue)}"
              />
            </td>
            <td>
              <button type="button" class="order-packing-btn">Packing List</button>
            </td>
            <td>
              <button type="button" class="order-save-btn">Save</button><p class="order-save-status" role="status" aria-live="polite"></p>
            </td>
          </tr>
        `;
      })
      .join("");

    ordersTbody.innerHTML = rowsHtml;
    filterOrders();
  }

  async function loadOrders() {
    if (!ordersTbody) return;

    ordersTbody.innerHTML = `
      <tr>
        <td colspan="7">Loading orders…</td>
      </tr>
    `;

    try {
      const res = await adminFetch("/admin/orders");

      if (res.status === 401) {
        ordersTbody.innerHTML = `
          <tr>
            <td colspan="7">Not authorized. Please log in again.</td>
          </tr>
        `;
        return;
      }

      if (!res.ok) throw new Error("Failed to load orders");

      const data = await res.json();
      console.log("Loaded admin orders:", data);
      renderOrdersTable(data.orders || []);
    } catch (err) {
      console.error("Error loading orders:", err);
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="7">Error loading orders.</td>
        </tr>
      `;
    }
  }

  if (ordersTbody) {
    ordersTbody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const row = target.closest("tr");
      if (!row) return;

      const orderId = row.getAttribute("data-order-id");
      if (!orderId) return;

      if(target.classList.contains('order-detail-btn')) {
        const dialog=document.getElementById('order-detail-dialog'),content=document.getElementById('order-detail-content');content.textContent='Loading order…';dialog.showModal();
        try{const res=await adminFetch(`/admin/orders/${orderId}`);const data=await res.json();if(!res.ok)throw new Error(data.error||'Order unavailable');
          content.innerHTML=`<p><strong>Order #${escapeHtml(data.id)} · ${escapeHtml(fulfillmentLabel(data.status))}</strong></p><p><strong>Payment:</strong> ${escapeHtml(paymentLabel(data))}${data.refundedCents?` · Refunded: ${(data.refundedCents/100).toFixed(2)}`:""}</p><p>${escapeHtml(data.customerName)}<br>${escapeHtml(data.customerEmail)}</p><h3>Items</h3><ul>${(data.items||[]).map(i=>`<li>${escapeHtml(i.qty||i.quantity||1)} × ${escapeHtml(i.name||'Item')}${i.customHat?` — ${escapeHtml(i.customHat.patchName||'Custom patch')} / ${escapeHtml(i.customHat.patchVariantName||'Default')} ${escapeHtml(i.customHat.patchMaterial||'')}, ${escapeHtml(i.customHat.placement)}`:''}${i.customApparel?'<p>'+i.customApparel.selections.map(s=>escapeHtml(s.side+': '+s.designName+(s.personalization?' / '+s.personalization:''))).join('<br>')+'</p>':''}${i.color?' · '+escapeHtml(i.color):''}${i.size?' · '+escapeHtml(i.size):''}${(i.customHat||i.customApparel)&&i.customerNote?'<p><strong>Customer note:</strong> '+escapeHtml(i.customerNote)+'</p>':''}</li>`).join('')}</ul><h3>Fulfillment</h3><pre>${escapeHtml(data.shipping?[data.shipping.fulfillment||data.shipping.method||'',data.shipping.name||data.shipping.customerName||'',data.shipping.address1||data.shipping.addressLine1||'',data.shipping.address2||data.shipping.addressLine2||'', [data.shipping.city,data.shipping.state,data.shipping.postalCode||data.shipping.zip].filter(Boolean).join(', '),data.shipping.phone||''].filter(Boolean).join('\n')||'No shipping address recorded':'No shipping details recorded')}</pre><p>Total: ${data.total==null?'Unavailable':'$'+Number(data.total).toFixed(2)}</p>`;
        }catch(e){content.textContent=e.message;}return;
      }
      if (target.classList.contains("order-packing-btn")) {
        const url = `${API_BASE}/admin/orders/${orderId}/packing-slip`;
        window.open(url, "_blank");
        return;
      }

      if (!target.classList.contains("order-save-btn")) return;

      const statusSelect = row.querySelector(".order-status-input");
      const trackingInput = row.querySelector(".order-tracking-input");

      const status = statusSelect ? statusSelect.value : undefined;
      const trackingNumber = trackingInput ? trackingInput.value : "";

      const feedback=row.querySelector(".order-save-status");
      if(feedback)feedback.textContent="";
      const originalText = target.textContent;
      target.disabled = true;
      target.textContent = "Saving...";

      try {
        const res = await adminFetch(`/admin/orders/${orderId}`, {
          method: "PUT",
          body: JSON.stringify({ status, trackingNumber, notifyCustomer: false }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if(feedback)feedback.textContent=data.error || "Unable to save this order.";
          console.error("Failed to update order:", data);
          target.textContent = "Error";
          setTimeout(() => {
            target.textContent = originalText;
            target.disabled = false;
          }, 1500);
          return;
        }

        console.log("Order updated:", data);
        target.textContent = "Saved";
        if(feedback)feedback.textContent=status==="CANCELLED"?"Cancelled. No refund was issued; manage refunds in Square.":"Fulfillment saved.";

        if (status === "ARCHIVED") await loadOrders();

        setTimeout(() => {
          target.textContent = originalText;
          target.disabled = false;
        }, 1200);
      } catch (err) {
        if(feedback)feedback.textContent="Unable to save. Check your connection and try again.";
        console.error("Error updating order:", err);
        target.textContent = "Error";
        setTimeout(() => {
          target.textContent = originalText;
          target.disabled = false;
        }, 1500);
      }
    });
  }

  // =======================
  //  ARCHIVE DOWNLOAD
  // =======================
  function downloadOrderArchive() {
    if (archiveStatusEl) {
      showStatus(
        archiveStatusEl,
        "Preparing archive download… (your browser should prompt to save a ZIP file)",
        false
      );
    }
    window.open(`${API_BASE}/admin/orders/archive-download`, "_blank");
  }

  // =======================
  //  PRODUCTS / FLAGS UI
  // =======================
  function renderProductsTable(products) {
    if (!flagsTbody) return;

    if (!Array.isArray(products) || products.length === 0) {
      flagsTbody.innerHTML = `
        <tr>
          <td colspan="7">No products found.</td>
        </tr>
      `;
      return;
    }

    const rowsHtml = products
      .map((p) => {
        const flags = p.flags || {};
        const totalInv = typeof p.totalInventory === "number" ? p.totalInventory : 0;

        const ribbonType = flags.ribbonType || "none";
        const ribbonText = flags.ribbonCustomText || "";

        return `
  <tr data-product-id="${escapeHtml(p.id)}">
    <td class="prod-name">${escapeHtml(p.name)}</td>
    <td class="prod-subcat">${escapeHtml(p.subcategory || "-")}</td>
    <td class="prod-inv">${totalInv}</td>

    <td class="prod-flags">
      <label class="flag-pill">
        <input type="checkbox" class="flag-pinToTop" ${flags.pinToTop ? "checked" : ""} />
        Pin to top
      </label>
    </td>

    <td class="prod-hide-online">
      <label class="flag-pill">
        <input type="checkbox" class="flag-hideOnline" ${flags.hideOnline ? "checked" : ""} />
        Hide Online
      </label>
    </td>

    <td class="prod-hide-kiosk">
      <label class="flag-pill">
        <input type="checkbox" class="flag-hideKiosk" ${flags.hideKiosk ? "checked" : ""} />
        Hide Kiosk
      </label>
    </td>

    <td class="prod-ribbon">
      <select class="flag-ribbonType">
        <option value="none" ${ribbonType === "none" ? "selected" : ""}>No ribbon</option>
        <option value="new" ${ribbonType === "new" ? "selected" : ""}>New</option>
        <option value="featured" ${ribbonType === "featured" ? "selected" : ""}>Featured</option>
        <option value="custom" ${ribbonType === "custom" ? "selected" : ""}>Custom</option>
      </select>
      <input
        type="text"
        class="flag-ribbonCustomText"
        placeholder="Custom ribbon text"
        value="${escapeHtml(ribbonText)}"
      />
    </td>
  </tr>
`;
      })
      .join("");

    flagsTbody.innerHTML = rowsHtml;
  }

  function captureProductFlagEdits() {
    flagsTbody?.querySelectorAll('tr[data-product-id]').forEach(row=>{const p=adminProducts.find(p=>p.id===row.dataset.productId);if(!p)return;
      p.flags={...p.flags,isNew:row.querySelector('.flag-ribbonType')?.value==='new',isFeatured:row.querySelector('.flag-ribbonType')?.value==='featured',pinToTop:row.querySelector('.flag-pinToTop')?.checked||false,hideOnline:row.querySelector('.flag-hideOnline')?.checked||false,hideKiosk:row.querySelector('.flag-hideKiosk')?.checked||false,ribbonType:row.querySelector('.flag-ribbonType')?.value||'none',ribbonCustomText:row.querySelector('.flag-ribbonCustomText')?.value||''};
    });
  }
  function applyFlagsFiltersAndRender() {
    captureProductFlagEdits();
    if (!flagsTbody) return;

    const query = (flagsSearchInput?.value || "").trim().toLowerCase();
    const subcatFilter = (flagsSubcatFilter?.value || "").trim().toLowerCase();

    const filtered = (adminProducts || []).filter((p) => {
      if (!p) return false;

      const name = (p.name || "").toLowerCase();
      const subcat = (p.subcategory || "").toLowerCase();

      const matchesSearch = !query || name.includes(query) || subcat.includes(query);
      const matchesSubcat = !subcatFilter || (subcat && subcat === subcatFilter);

      return matchesSearch && matchesSubcat;
    });

    renderProductsTable(filtered);
  }

  async function loadAdminProducts() {
    if (!flagsTbody) return;

    flagsTbody.innerHTML = `
      <tr>
        <td colspan="7">Loading products…</td>
      </tr>
    `;

    showStatus(flagsStatusEl, "Loading products...", false);

    try {
      const res = await adminFetch("/admin/products");

      if (res.status === 401) {
        flagsTbody.innerHTML = `
          <tr>
            <td colspan="7">Not authorized. Please log in again.</td>
          </tr>
        `;
        showStatus(flagsStatusEl, "Not authorized. Please log in again.", true);
        return;
      }

      if (!res.ok) throw new Error("Failed to load admin products");

      const data = await res.json();
      adminProducts = Array.isArray(data.products) ? data.products : [];
      console.log("Loaded admin products:", adminProducts);

      if (flagsSubcatFilter) {
        const subcats = new Set();
        adminProducts.forEach((p) => {
          if (p.subcategory) subcats.add(p.subcategory);
        });

        const currentValue = flagsSubcatFilter.value;
        flagsSubcatFilter.innerHTML =
          '<option value="">All subcategories</option>' +
          Array.from(subcats)
            .sort()
            .map((s) => `<option value="${s}">${s}</option>`)
            .join("");

        if (currentValue) flagsSubcatFilter.value = currentValue;
      }

      applyFlagsFiltersAndRender();
      showStatus(flagsStatusEl, "Products loaded.", false);
    } catch (err) {
      console.error("Error loading admin products:", err);
      flagsTbody.innerHTML = `
        <tr>
          <td colspan="7">Error loading products.</td>
        </tr>
      `;
      showStatus(flagsStatusEl, "Error loading products.", true);
    }
  }

  async function saveAdminProducts() {
    if (!flagsTbody) return;

    showStatus(flagsStatusEl, "Saving product flags...", false);

    captureProductFlagEdits();
    const rows = flagsTbody.querySelectorAll("tr[data-product-id]");
    const updates = [];

    rows.forEach((row) => {
      const id = row.getAttribute("data-product-id");
      if (!id) return;

      const pinToTopEl = row.querySelector(".flag-pinToTop");
      const hideOnlineEl = row.querySelector(".flag-hideOnline");
      const hideKioskEl = row.querySelector(".flag-hideKiosk");
      const ribbonTypeEl = row.querySelector(".flag-ribbonType");
      const ribbonTextEl = row.querySelector(".flag-ribbonCustomText");

      const ribbonType = ribbonTypeEl ? ribbonTypeEl.value || "none" : "none";
      const ribbonCustomText = ribbonTextEl ? ribbonTextEl.value || "" : "";

      const flags = {
        isNew: ribbonType === "new",
        isFeatured: ribbonType === "featured",
        pinToTop: !!(pinToTopEl && pinToTopEl.checked),
        hideOnline: !!(hideOnlineEl && hideOnlineEl.checked),
        hideKiosk: !!(hideKioskEl && hideKioskEl.checked),
        ribbonType,
        ribbonCustomText,
      };

      updates.push({ id, flags });
    });

    try {
      const res = await adminFetch("/admin/products", {
        method: "PUT",
        body: JSON.stringify({ products: adminProducts.map(p=>({id:p.id,flags:p.flags})) }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showStatus(flagsStatusEl, data.error || "Failed to save product flags.", true);
        return;
      }

      console.log("Saved productConfig:", data);
      showStatus(flagsStatusEl, "Product flags saved.", false);
    } catch (err) {
      console.error("Error saving product flags:", err);
      showStatus(flagsStatusEl, "Error saving product flags.", true);
    }
  }

  // =======================
  //  CATALOG / INVENTORY SYNC
  // =======================
  async function callSyncEndpoint(path, label) {
    if (!syncStatusEl) return;

    showStatus(syncStatusEl, `${label}…`, false);

    try {
      const res = await adminFetch(path, { method: "POST", body: JSON.stringify({}) });

      if (res.status === 401) {
        showStatus(syncStatusEl, "Not authorized. Please log in again.", true);
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showStatus(syncStatusEl, data.error || `${label} failed.`, true);
        return;
      }

      console.log("Sync result:", data);
      showStatus(syncStatusEl, `${label} completed.`, false);
    } catch (err) {
      console.error("Sync error:", err);
      showStatus(syncStatusEl, `${label} failed (network error).`, true);
    }
  }

  // =======================
  //  BARCODE LABELS / INVENTORY
  // =======================
  function renderBarcodeProducts(products) {
    if (!barcodeProductsContainer) return;

    if (!Array.isArray(products) || products.length === 0) {
      barcodeProductsContainer.innerHTML = "<p>No products found for the current filters.</p>";
      return;
    }

    const html = products
      .map((p) => {
        const safeName = escapeHtml(p.name || "Unnamed product");
        const safeSubcat = escapeHtml(p.subcategory || "");

        const variations = Array.isArray(p.variations)
          ? [...p.variations].sort((a, b) => {
              const nameA = (a.name || "").toLowerCase();
              const nameB = (b.name || "").toLowerCase();
              if (nameA !== nameB) return nameA.localeCompare(nameB);

              const colorA = (a.color || "").toLowerCase();
              const colorB = (b.color || "").toLowerCase();
              if (colorA !== colorB) return colorA.localeCompare(colorB);

              const sizeA = (a.size || "").toLowerCase();
              const sizeB = (b.size || "").toLowerCase();
              if (sizeA !== sizeB) return sizeA.localeCompare(sizeB);

              const skuA = (a.sku || "").toLowerCase();
              const skuB = (b.sku || "").toLowerCase();
              return skuA.localeCompare(skuB);
            })
          : [];

        if (!variations.length) return "";

        const varsHtml = variations
          .map((v) => {
            const sku = v.sku || "";
            const safeSku = escapeHtml(sku);
            const vName = v.name || "";
            const safeVName = escapeHtml(vName);
            const color = v.color || "";
            const size = v.size || "";
            const safeColor = escapeHtml(color);
            const safeSize = escapeHtml(size);
            const qty =
              typeof v.quantity === "number" && !Number.isNaN(v.quantity) ? v.quantity : 0;

            const isChecked = sku && selectedBarcodeSkus.has(sku);
            const savedLabelQty =
              sku && Number.isFinite(Number(labelQtyBySku[sku])) ? Number(labelQtyBySku[sku]) : 1;

            // Apply persistent “seen/last” classes based on session scans
            const scannedVal = Number(scanCountsBySku[sku] || 0);
            const rowClassExtra = scannedVal > 0 ? " scan-seen" : "";

            return `
            <tr
              class="barcode-variant-row${rowClassExtra}"
              data-sku="${safeSku}"
              data-product-name="${safeName}"
            >
              <td>
                <input type="checkbox" class="barcode-variant-check" ${isChecked ? "checked" : ""} />
              </td>
              <td class="bc-variant-name">${safeVName}</td>
              <td class="bc-variant-sku">${safeSku || "-"}</td>
              <td class="bc-variant-color">${safeColor || "-"}</td>
              <td class="bc-variant-size">${safeSize || "-"}</td>
              <td class="bc-variant-stock">${qty}</td>
              <td>
                <input type="number" class="inv-count-input" step="1" placeholder="+ / −" style="width: 4rem;" />
              </td>
              <td>
                <input
                  type="number"
                  class="barcode-qty-input"
                  min="1"
                  step="1"
                  value="${savedLabelQty}"
                  style="width: 4rem;"
                />
              </td>
            </tr>
          `;
          })
          .join("");

        if (!varsHtml) return "";

        return `
        <div class="barcode-product" data-product-id="${escapeHtml(p.id)}">
          <div class="barcode-product-header">
            <button type="button" class="barcode-toggle" aria-label="Toggle variants">▾</button>
            <div class="barcode-product-title">
              <div class="barcode-product-name">${safeName}</div>
              <div class="barcode-product-subcat">${
                safeSubcat ? `Subcategory: ${safeSubcat}` : "&nbsp;"
              }</div>
            </div>
            <div class="barcode-product-actions">
              <label class="admin-checkbox">
                <input type="checkbox" class="barcode-product-check-all" />
                <span>Check all</span>
              </label>
            </div>
          </div>
          <div class="barcode-variants">
            <table class="admin-table barcode-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Variant</th>
                  <th>SKU</th>
                  <th>Color</th>
                  <th>Size</th>
                  <th>In-stock</th>
                  <th>Stock change (+ / −)</th>
                  <th>Labels to print</th>
                </tr>
              </thead>
              <tbody>${varsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
      })
      .join("");

    barcodeProductsContainer.innerHTML = html || "<p>No products found.</p>";

    applyScanCountsToDom();
  }

  function applyBarcodeFiltersAndRender() {
    if (!barcodeProductsContainer) return;

    const query = (barcodeSearchInput?.value || "").trim().toLowerCase();
    const showZero = barcodeShowZeroCheckbox ? barcodeShowZeroCheckbox.checked : true;
    const subcatFilter = (barcodeSubcatFilter?.value || "").trim().toLowerCase();

    const filteredProducts = (barcodeProductsRaw || [])
      .map((p) => {
        const baseMatchesName = !query || (p.name && p.name.toLowerCase().includes(query));
        const baseMatchesSubcat =
          !query || (p.subcategory && p.subcategory.toLowerCase().includes(query));

        const baseMatchesSubcatFilter =
          !subcatFilter || (p.subcategory && p.subcategory.toLowerCase() === subcatFilter);

        const variations = Array.isArray(p.variations) ? p.variations : [];

        const filteredVars = variations.filter((v) => {
          const vName = (v.name || "").toLowerCase();
          const vSku = (v.sku || "").toLowerCase();
          const vColor = (v.color || "").toLowerCase();
          const vSize = (v.size || "").toLowerCase();

          const searchMatches =
            (!query ||
              baseMatchesName ||
              baseMatchesSubcat ||
              vName.includes(query) ||
              vSku.includes(query) ||
              vColor.includes(query) ||
              vSize.includes(query)) &&
            baseMatchesSubcatFilter;

          if (!searchMatches) return false;

          if (!showZero) {
            const qty = typeof v.quantity === "number" && !Number.isNaN(v.quantity) ? v.quantity : 0;
            if (qty <= 0) return false;
          }

          return true;
        });

        if (!filteredVars.length) return null;

        return { ...p, variations: filteredVars };
      })
      .filter(Boolean);

    const sortedProducts = filteredProducts.sort((a, b) => {
      const subA = (a.subcategory || "").toLowerCase();
      const subB = (b.subcategory || "").toLowerCase();
      if (subA !== subB) return subA.localeCompare(subB);

      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

    renderBarcodeProducts(sortedProducts);
  }

  async function loadBarcodeProducts() {
    if (!barcodeProductsContainer) return;

    barcodeProductsContainer.innerHTML = "<p>Loading products…</p>";
    showStatus(barcodeStatusEl, "Loading barcode products...", false);

    try {
      const res = await adminFetch("/admin/barcode-products");

      if (res.status === 401) {
        showStatus(barcodeStatusEl, "Not authorized. Please log in again.", true);
        barcodeProductsContainer.innerHTML = "<p>Not authorized. Please log in again.</p>";
        return;
      }

      if (!res.ok) throw new Error("Failed to load barcode products");

      const data = await res.json();
      barcodeProductsRaw = Array.isArray(data.products) ? data.products : [];
      console.log("Loaded barcode products:", barcodeProductsRaw);

      rebuildScanSkuIndex();

      if (barcodeSubcatFilter) {
        const subcats = new Set();
        barcodeProductsRaw.forEach((p) => {
          if (p.subcategory) subcats.add(p.subcategory);
        });

        const currentValue = barcodeSubcatFilter.value;
        barcodeSubcatFilter.innerHTML =
          '<option value="">All subcategories</option>' +
          Array.from(subcats)
            .sort()
            .map(
              (s) =>
                `<option value="${escapeHtml(s)}"${
                  currentValue === s ? " selected" : ""
                }>${escapeHtml(s)}</option>`
            )
            .join("");
      }

      applyBarcodeFiltersAndRender();
      showStatus(barcodeStatusEl, "Barcode products loaded.", false);
    } catch (err) {
      console.error("Error loading barcode products:", err);
      barcodeProductsContainer.innerHTML = "<p>Error loading barcode products.</p>";
      showStatus(barcodeStatusEl, "Error loading barcode products.", true);
    }
  }

  // Delegate clicks/changes/inputs inside barcode container
  if (barcodeProductsContainer) {
    barcodeProductsContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("barcode-toggle")) {
        const productEl = target.closest(".barcode-product");
        if (!productEl) return;

        const variantsEl = productEl.querySelector(".barcode-variants");
        if (!variantsEl) return;

        const isHidden =
          variantsEl.style.display === "none" ||
          getComputedStyle(variantsEl).display === "none";

        variantsEl.style.display = isHidden ? "" : "none";
        target.textContent = isHidden ? "▾" : "▸";
      }
    });

    barcodeProductsContainer.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("barcode-variant-check")) {
        const row = target.closest(".barcode-variant-row");
        if (!row) return;

        const sku = row.getAttribute("data-sku") || "";
        if (!sku) return;

        if (target.checked) selectedBarcodeSkus.add(sku);
        else selectedBarcodeSkus.delete(sku);
        return;
      }

      if (target.classList.contains("barcode-product-check-all")) {
        const productEl = target.closest(".barcode-product");
        if (!productEl) return;

        const checks = productEl.querySelectorAll(".barcode-variant-check");
        checks.forEach((cb) => {
          cb.checked = target.checked;

          const row = cb.closest(".barcode-variant-row");
          const sku = row ? row.getAttribute("data-sku") || "" : "";
          if (!sku) return;

          if (target.checked) selectedBarcodeSkus.add(sku);
          else selectedBarcodeSkus.delete(sku);
        });
        return;
      }
    });

    barcodeProductsContainer.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if(target.classList.contains('inv-count-input')) {
        const sku=target.closest('.barcode-variant-row')?.dataset.sku;
        if(sku){const n=Number(target.value);if(target.value.trim()===''||n===0)delete scanCountsBySku[sku];else if(Number.isInteger(n))scanCountsBySku[sku]=n;else delete scanCountsBySku[sku];}
      }
      if (target.classList.contains("barcode-qty-input")) {
        const row = target.closest(".barcode-variant-row");
        if (!row) return;

        const sku = row.getAttribute("data-sku") || "";
        if (!sku) return;

        const n = parseInt(target.value, 10);
        labelQtyBySku[sku] = Number.isFinite(n) && n > 0 ? n : 1;
      }
    });
  }

  async function handleBarcodePrintSelected() {
    if (!barcodeProductsContainer) return;

    const selectedSkus = Array.from(selectedBarcodeSkus);

    if (!selectedSkus.length) {
      showStatus(
        barcodeStatusEl,
        "No variants are selected. Check at least one row (selection persists across searches).",
        true
      );
      return;
    }

    const items = [];

    selectedSkus.forEach((sku) => {
      const found = findVariantBySku(sku);
      if (!found) return;

      const { product, variant } = found;

      const productName = product?.name || "";
      const variantName = variant?.name || "";
      const color = variant?.color || "";
      const size = variant?.size || "";

      const qty = Number.isFinite(Number(labelQtyBySku[sku]))
        ? Math.max(1, parseInt(labelQtyBySku[sku], 10))
        : 1;

      const labelParts = [];
      if (productName) labelParts.push(productName);
      const detailParts = [variantName, color, size].filter(Boolean);
      if (detailParts.length) labelParts.push(detailParts.join(" "));

      const labelText = labelParts.join(" - ").trim() || sku || "Label";

      items.push({ sku: sku || null, labelText, quantity: qty });
    });

    if (!items.length) {
      showStatus(barcodeStatusEl, "No valid items collected for barcode generation.", true);
      return;
    }

    const output=document.getElementById("label-output")?.value||"print";
    if (output==="print" && barcodePrintToLabelCheckbox && !barcodePrintToLabelCheckbox.checked) {
      showStatus(barcodeStatusEl, "Check 'Print to label printer' before printing labels.", true);
      return;
    }

    showStatus(barcodeStatusEl, output==="pdf"?"Preparing label PDF…":"Sending labels to printer…", false);

    try {
      const res = await adminFetch("/admin/generate-barcodes", {
        method: "POST",
        body: JSON.stringify({ items, mode: output }),
      });

      if(output==='pdf'&&res.ok){const blob=await res.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='BrackishRoots-Barcode-Labels.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showStatus(barcodeStatusEl,'Label PDF downloaded.');return;}
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.error) {
        console.error("Barcode generation/print failed:", data);
        showStatus(
          barcodeStatusEl,
          data && data.error ? `Failed to print labels: ${data.error}` : "Failed to print labels.",
          true
        );
        return;
      }

      console.log("Barcode print result:", data);
      showStatus(barcodeStatusEl, data.message || "Labels processed and sent to label printer.", false);
    } catch (err) {
      console.error("Error generating barcode labels:", err);
      showStatus(barcodeStatusEl, "Error generating barcode labels (network or server error).", true);
    }
  }

  // =======================
  //  BARCODE SCAN → COUNTED QTY
  // =======================
  (function initBarcodeScanToCount() {
    let scanBuffer = "";
    let lastEventTime = 0;

    // Some scanners are slower; 220ms works better than 120ms
    const SCAN_RESET_MS = 220;

    // Prime audio once (helps Chrome allow beep)
    let audioPrimed = false;
    function primeAudioOnce() {
      if (audioPrimed) return;
      audioPrimed = true;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        ctx.resume?.().finally(() => ctx.close().catch(() => {}));
      } catch (_) {}
    }
    window.addEventListener("click", primeAudioOnce, { once: true });
    window.addEventListener("keydown", primeAudioOnce, { once: true });

    function isTextArea(el) {
      return !!el && el.tagName && el.tagName.toLowerCase() === "textarea";
    }

    function isInputLike(el) {
      if (!el || !el.tagName) return false;
      if (barcodeScanInput && el === barcodeScanInput) return false; // allow scanner box
      const tag = el.tagName.toLowerCase();
      if (tag !== "input") return false;
      const type = (el.getAttribute("type") || "").toLowerCase();
      return type === "text" || type === "number" || type === "search" || type === "email" || type === "tel";
    }

    function handleScanComplete(codeRaw) {
      const raw = (codeRaw || "").trim();
      if (!raw) return;

      const sku = resolveSkuFromScan(raw);
      if (!sku) {
        showStatus(
          barcodeStatusEl,
          `Scanned "${raw}" but it doesn't match any SKU in the current list.`,
          true
        );
        return;
      }

      // Ensure it can be shown (clear filters if needed), then increment
      ensureRowVisibleThenScroll(sku);
      const nextVal = bumpScanCountForSku(sku);

      showStatus(barcodeStatusEl, `Scanned ${raw} → SKU ${sku} — counted qty now ${nextVal}`, false);
    }

    function handleKeydown(e) {
      if(document.body.classList.contains('business-admin') && document.getElementById('inventory')?.hidden){scanBuffer='';return;}
      if(isInputLike(e.target) && e.target!==barcodeScanInput)return;
      const now = Date.now();
      const dt = now - lastEventTime;

      // If user is typing slowly in an input, ignore.
      // If it's fast like scanner, still capture.
      if ((isInputLike(e.target) || isTextArea(e.target)) && dt > SCAN_RESET_MS) {
        lastEventTime = now;
        scanBuffer = "";
        return;
      }

      if (dt > SCAN_RESET_MS) {
        scanBuffer = "";
        if (barcodeScanInput) barcodeScanInput.value = "";
      }
      lastEventTime = now;

      // Many scanners end with Enter or Tab
      if (e.key === "Enter" || e.key === "Tab") {
        const code = scanBuffer;
        scanBuffer = "";
        if (barcodeScanInput) barcodeScanInput.value = "";
        if (code) {
          e.preventDefault();
          handleScanComplete(code);
        }
        return;
      }

      // Collect printable characters only
      if (e.key && e.key.length === 1) {
        scanBuffer += e.key;
        if (barcodeScanInput) barcodeScanInput.value = scanBuffer;
      }
    }

    window.addEventListener("keydown", handleKeydown);
  })();

  // =======================
  //  RETURN TO TOP BUTTON
  // =======================
  function initScrollToTopButton() {
    if (document.getElementById("scrollToTopBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scrollToTopBtn";
    btn.type = "button";
    btn.textContent = "↑ Top";

    Object.assign(btn.style, {
      position: "fixed",
      right: "1.25rem",
      bottom: "1.25rem",
      zIndex: "999",
      padding: "0.5rem 0.9rem",
      borderRadius: "999px",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "0.9rem",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 0.2s ease-in-out",
      backgroundColor: "#23453d",
      color: "#ffffff",
    });

    document.body.appendChild(btn);

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", () => {
      if (window.scrollY > 300) {
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
      } else {
        btn.style.opacity = "0";
        btn.style.pointerEvents = "none";
      }
    });
  }

  // =======================
  //  EVENT LISTENERS
  // =======================
  if (bannerForm) bannerForm.addEventListener("submit", saveBannerConfig);
  if (refreshOrdersBtn) refreshOrdersBtn.addEventListener("click", loadOrders);
  if (archiveBtn) archiveBtn.addEventListener("click", downloadOrderArchive);
  if (saveFlagsBtn) saveFlagsBtn.addEventListener("click", saveAdminProducts);

  if (flagsSearchInput) flagsSearchInput.addEventListener("input", applyFlagsFiltersAndRender);
  if (flagsSubcatFilter) flagsSubcatFilter.addEventListener("change", applyFlagsFiltersAndRender);

  if (flagsToggleBtn && flagsSection) {
    flagsSection.classList.add("flags-collapsed");
    flagsToggleBtn.textContent = "Expand Products";

    flagsToggleBtn.addEventListener("click", () => {
      const collapsed = flagsSection.classList.toggle("flags-collapsed");
      flagsToggleBtn.textContent = collapsed ? "Expand Products" : "Collapse Products";
    });
  }

  if (ordersToggleBtn && ordersSection) {
    ordersSection.classList.add("orders-collapsed");
    ordersToggleBtn.textContent = "Expand Orders";

    ordersToggleBtn.addEventListener("click", () => {
      const collapsed = ordersSection.classList.toggle("orders-collapsed");
      ordersToggleBtn.textContent = collapsed ? "Expand Orders" : "Collapse Orders";
    });
  }

  if (syncCatalogBtn) {
    syncCatalogBtn.addEventListener("click", () =>
      callSyncEndpoint("/admin/sync/catalog", "Catalog + inventory sync")
    );
  }

  if (syncInventoryBtn) {
    syncInventoryBtn.addEventListener("click", () =>
      callSyncEndpoint("/admin/sync/inventory", "Inventory-only sync")
    );
  }

  if (barcodeSearchInput) barcodeSearchInput.addEventListener("input", applyBarcodeFiltersAndRender);
  if (barcodeSubcatFilter) barcodeSubcatFilter.addEventListener("change", applyBarcodeFiltersAndRender);
  if (barcodeShowZeroCheckbox) barcodeShowZeroCheckbox.addEventListener("change", applyBarcodeFiltersAndRender);

  if (barcodeRefreshBtn) barcodeRefreshBtn.addEventListener("click", loadBarcodeProducts);
  if (barcodePrintSelectedBtn) barcodePrintSelectedBtn.addEventListener("click", handleBarcodePrintSelected);

  // Manual and scanned changes survive filtering; clear only confirmed applied SKUs.
  if(barcodeApplyInventoryBtn)barcodeApplyInventoryBtn.addEventListener('click',async()=>{
    if(barcodeProductsContainer.querySelector('.inv-count-input:invalid')){showStatus(barcodeStatusEl,'Use whole numbers for stock changes. Correct the highlighted input before applying.',true);barcodeProductsContainer.querySelector('.inv-count-input:invalid').reportValidity();return;}
    const updates=Object.entries(scanCountsBySku).filter(([sku,n])=>sku&&Number.isInteger(Number(n))&&Number(n)!==0).map(([sku,newQty])=>({sku,newQty:Number(newQty)}));
    if(!updates.length){showStatus(barcodeStatusEl,'No stock changes entered. Scan items or enter a positive or negative adjustment.',true);return;}
    const review=updates.slice(0,10).map(u=>`${u.sku}: ${u.newQty>0?'+':''}${u.newQty}`).join('\n');
    if(!confirm(`Apply these stock changes to Square?\n\n${review}${updates.length>10?'\n… and '+(updates.length-10)+' more SKUs':''}\n\n${updates.length} SKUs · Net change ${updates.reduce((n,u)=>n+u.newQty,0)}`))return;
    barcodeApplyInventoryBtn.disabled=true;showStatus(barcodeStatusEl,'Updating Square inventory…');
    try{const res=await adminFetch('/admin/apply-inventory-count',{method:'POST',body:JSON.stringify({updates})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Inventory update failed');
      for(const item of data.applied||[]){const sku=item.input?.sku||item.sku;if(sku)delete scanCountsBySku[sku];}
      await loadBarcodeProducts();
      const errors=data.errors||[];showStatus(barcodeStatusEl,`${data.appliedCount||0} changes applied.${errors.length?' '+errors.length+' changes were not applied: '+errors.map(e=>`${e.input?.sku||'SKU'} — ${e.error}`).join('; '):' Square stock refreshed.'}`,errors.length>0);
    }catch(e){showStatus(barcodeStatusEl,e.message+' Your entered adjustments have been kept for review.',true);}finally{barcodeApplyInventoryBtn.disabled=false;}
  });

  if (barcodeToggleBtn && barcodeSection) {
    barcodeSection.classList.add("barcode-collapsed");
    barcodeToggleBtn.textContent = "Expand Inventory";

    barcodeToggleBtn.addEventListener("click", () => {
      const collapsed = barcodeSection.classList.toggle("barcode-collapsed");
      barcodeToggleBtn.textContent = collapsed ? "Expand Inventory" : "Collapse Inventory";
    });
  }

  // =======================
  //  INITIAL LOAD
  // =======================
  (async () => {
    const ok = await ensureAdminSession();
    if (!ok) return;

    scheduleInactivityLogout();

    window.BrackishAdminTools = {patches:loadPatchesUI,orders:loadOrders,catalog:loadAdminProducts,inventory:loadBarcodeProducts,storefront:loadBannerConfig};
    window.dispatchEvent(new Event('br-admin-tools-ready'));

    initScrollToTopButton();
  })();
});

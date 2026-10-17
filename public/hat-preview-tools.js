/* Brackish Roots hat builder. Reads existing Square products and /patches.
   Custom configurations are saved/requested, never charged as an unconfigured blank hat. */
(() => {
  'use strict';
  const finite = (value, fallback) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const qty = variation => {
    for (const field of ['availableQty','available_quantity','inventory','quantity','stock','qty','onHand','on_hand','quantityOnHand','quantity_on_hand','inventoryCount']) {
      if (variation?.[field] !== undefined && variation[field] !== null && variation[field] !== '') {
        const number = Number(variation[field]); if (Number.isFinite(number)) return Math.max(0,number);
      }
    }
    return 0;
  };
  const variations = hat => Array.isArray(hat?.squareVariations) ? hat.squareVariations : Array.isArray(hat?.variations) ? hat.variations : [];
  const color = variation => String(variation?.color || variation?.name || 'Default');
  const images = (variation, hat) => Array.isArray(variation?.images) && variation.images.length ? variation.images.filter(src => typeof src === 'string' && src) : [variation?.image || hat?.image].filter(Boolean);
  const price = (variation,hat) => finite(variation?.price,finite(hat?.price,0));
  const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const key = item => String(item?.catalogObjectId || item?.id || item?.squareVariationId || '');
  function geometry(hatName, patch, placement, imageRatio=1, stageRatio=1) {
    const calibration = /richardson\s*112/i.test(hatName) ? { width:56, height:34, x:50, y:51 } : { width:72, height:44, x:50, y:48 };
    const prefix = placement === 'Left' ? 'previewLeft' : placement === 'Right' ? 'previewRight' : 'previewCenter';
    const scale = clamp(finite(patch?.[prefix+'Scale'], placement === 'Center' ? finite(patch?.previewScale,1) : 1),.25,3);
    const offsetX = finite(patch?.[prefix+'OffsetX'],placement === 'Center' ? finite(patch?.previewOffsetX,0) : 0);
    const offsetY = finite(patch?.[prefix+'OffsetY'],placement === 'Center' ? finite(patch?.previewOffsetY,0) : 0);
    const renderedWidth = imageRatio >= stageRatio ? 100 : 100*imageRatio/stageRatio;
    const renderedHeight = imageRatio >= stageRatio ? 100*stageRatio/imageRatio : 100;
    const shift = placement === 'Left' ? calibration.width*.25 : placement === 'Right' ? -calibration.width*.25 : 0;
    return {
      width: Math.max(.25,finite(patch?.widthInches,3))/7*calibration.width*scale*renderedWidth/100,
      height: Math.max(.25,finite(patch?.heightInches,2))/3*calibration.height*scale*renderedHeight/100,
      left: (100-renderedWidth)/2 + renderedWidth*(calibration.x+shift+offsetX*.5)/100,
      top: (100-renderedHeight)/2 + renderedHeight*(calibration.y+offsetY*.5)/100,
    };
  }
  window.BrackishHatTools = { qty, geometry, images, price };
})();

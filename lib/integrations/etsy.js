'use strict';
// Extension boundary only. Nothing is synchronized or published to Etsy.
// Implement OAuth, scopes, consent, rate limiting and reconciliations before enabling.
module.exports={
 channel:'etsy',connected:false,
 capabilities:{listingSync:false,orderImport:false,inventorySync:false},
 async connect(){throw new Error('Etsy is not connected. OAuth and API access must be implemented first.');},
 async publishListing(){throw new Error('Etsy publishing is disabled.');},
 async importOrders(){throw new Error('Etsy order import is disabled.');}
};

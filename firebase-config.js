/* =====================================================================
   FIREBASE CONFIG
   ---------------------------------------------------------------------
   Leave this exactly as-is and the game runs in LOCAL MODE:
   it still works perfectly, but only across tabs on ONE computer
   (great for testing and for a single-screen classroom setup).

   To let students join from their own phones/laptops, follow
   FIREBASE-SETUP.md, then paste your config object below and set
   enabled: true.
   ===================================================================== */

window.FACEOFF_FIREBASE = {
  enabled: false,

  config: {
    apiKey: "PASTE_YOURS_HERE",
    authDomain: "PASTE_YOURS_HERE",
    databaseURL: "PASTE_YOURS_HERE",
    projectId: "PASTE_YOURS_HERE",
    storageBucket: "PASTE_YOURS_HERE",
    messagingSenderId: "PASTE_YOURS_HERE",
    appId: "PASTE_YOURS_HERE"
  }
};

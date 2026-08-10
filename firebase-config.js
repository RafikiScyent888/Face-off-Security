/* =====================================================================
   FIREBASE CONFIG  —  Face-off: Security+
   ---------------------------------------------------------------------
   VERIFIED. Nothing in this file is a guess.

   Same Firebase project as the A+ Core 2 game (face-off-games). The
   databaseURL was confirmed by querying the database directly: it
   exists, it responds, and the rules allow reads and writes under
   rooms/. Upload as-is — no edits needed.

   All five Face-off games can share this one Firebase project. Each
   game writes to its own namespace (this one uses rooms/sec-XXXX),
   so a Security+ room code can never collide with another game’s.
   ===================================================================== */

window.FACEOFF_FIREBASE = {
  enabled: true,

  config: {
    apiKey: "AIzaSyCHgdXXUQngfZNtu9saeE-tJFBWYLUMhUs",
    authDomain: "face-off-games.firebaseapp.com",
    databaseURL: "https://face-off-games-default-rtdb.firebaseio.com",
    projectId: "face-off-games",
    storageBucket: "face-off-games.firebasestorage.app",
    messagingSenderId: "126038768937",
    appId: "1:126038768937:web:aaef27e8c41dd356e9cb38",
    measurementId: "G-BMBJB3YC3Z"
  }
};

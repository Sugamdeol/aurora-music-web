/* runBanner renders into this script's parent element. */
(() => {
  const host = document.currentScript?.parentElement;
  // This zone requires 728px; never inject it into a narrower viewport.
  if (!host || window.innerWidth < 760 || !window.aclib || typeof window.aclib.runBanner !== 'function') return;
  try { window.aclib.runBanner({ zoneId: '12261386' }); }
  catch (error) { console.warn('Adcash banner could not initialize:', error); }
})();

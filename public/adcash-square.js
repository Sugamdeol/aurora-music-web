/* Adcash renders the banner inside this script's parent element. */
(() => {
  const host = document.currentScript?.parentElement;
  if (!host || !window.aclib || typeof window.aclib.runBanner !== 'function') return;
  try { window.aclib.runBanner({ zoneId: '12261426' }); }
  catch (error) { console.warn('Adcash square banner could not initialize:', error); }
})();

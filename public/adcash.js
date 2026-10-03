/* Adcash standard Autotag. Failure must not stop Aurora from starting. */
(() => {
  if (!window.aclib || typeof window.aclib.runAutoTag !== 'function') return;
  try { window.aclib.runAutoTag({ zoneId: 'gak4ueqg4i' }); }
  catch (error) { console.warn('Adcash could not initialize:', error); }
})();

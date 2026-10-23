'use strict';
function render(state) {
  window.MikoView.applyAppearance(state);
  document.getElementById('speech').textContent = state.speech?.text || '';
}
window.mori.onState(render); window.mori.getState().then(render);

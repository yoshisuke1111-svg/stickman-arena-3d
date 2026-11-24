// The footage refills the light sector counterclockwise from three o'clock.
// Timings come from the authoritative server, not a second client-side table.
export function cooldownView(remaining, duration, elapsed = 0) {
  if (!Number.isFinite(remaining) || !Number.isFinite(duration) || duration <= 0) {
    return { ready: false, fraction: 1, remaining: null };
  }
  const seconds = Math.max(0, remaining - Math.max(0, elapsed));
  return {
    // Only a server snapshot can confirm that a skill is usable. A delayed
    // packet must not light the ready ring before the server accepts input.
    ready: remaining <= 0,
    fraction: Math.max(0, Math.min(1, seconds / duration)),
    remaining: seconds,
  };
}

export function createAbilityHud(root = document) {
  const controls = [
    { element: root.querySelector('[data-touch="skill"]'), index: 1, label: 'Skill' },
    { element: root.querySelector('[data-touch="super"]'), index: 2, label: 'Super' },
  ];
  let snapshot = null;
  let receivedAt = 0;
  let active = false;
  function render(now = performance.now()) {
    const elapsed = snapshot && active ? (now - receivedAt) / 1000 : 0;
    for (const control of controls) {
      const view = cooldownView(snapshot?.cd?.[control.index], snapshot?.cdMax?.[control.index], elapsed);
      const ready = active && !snapshot?.dead && view.ready;
      const element = control.element;
      element.style.setProperty('--cooldown-angle', `${(view.fraction * 360).toFixed(2)}deg`);
      element.classList.toggle('is-ready', ready);
      element.setAttribute('aria-disabled', String(!ready));
      // Accessible state is textual; the on-screen control keeps only its icon
      // and Skill/Super label, just as in the reference.
      const status = ready ? '使用可能' : snapshot?.dead ? 'KO中' :
        view.remaining > 0 ? `あと${Math.ceil(view.remaining)}秒` : '待機中';
      element.setAttribute('aria-label', `${control.label}、${status}`);
    }
  }
  return {
    sync(player, inBattle, now = performance.now()) {
      snapshot = player;
      receivedAt = now;
      active = inBattle;
      render(now);
    },
    render,
  };
}

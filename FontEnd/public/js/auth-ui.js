import { startSocialAuth } from './auth-api.js';

// Shared behaviors keep login and registration consistent.
export function setupAuthUI(showStatus) {
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(reveal));
      const label = button.dataset.passwordLabel || `mật khẩu${input.name === 'passwordConfirmation' ? ' nhập lại' : ''}`;
      button.setAttribute('aria-label', `${reveal ? 'Ẩn' : 'Hiện'} ${label}`);
      button.querySelector('use').setAttribute('href', `/assets/icons.svg#${reveal ? 'eye-off' : 'eye'}`);
    });
  });

  document.querySelectorAll('[data-provider]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await startSocialAuth(button.dataset.provider);
      } catch (error) {
        showStatus(error.message);
        document.querySelector('#form-status').scrollIntoView({ block: 'nearest' });
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  });

  const helpDialog = document.querySelector('#help-dialog');
  document.querySelector('[data-open-help]').addEventListener('click', () => helpDialog.showModal());
  document.querySelectorAll('.dialog-close, [data-close-help]').forEach((button) => button.addEventListener('click', () => helpDialog.close()));
  helpDialog.addEventListener('click', (event) => {
    const bounds = helpDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) helpDialog.close();
  });
}

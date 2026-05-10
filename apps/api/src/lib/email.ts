import { Resend } from 'resend';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const resend = new Resend(process.env['RESEND_API_KEY']);

const FROM = process.env['EMAIL_FROM'] ?? 'noreply@inmob.local';
const APP_DOMAIN = process.env['APP_DOMAIN'] ?? 'localhost:5173';

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetToken: string;
  subdomain: string;
}): Promise<void> {
  const params = new URLSearchParams({ token: opts.resetToken });
  const resetUrl = `https://${opts.subdomain}.${APP_DOMAIN}/reset-password?${params.toString()}`;

  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: 'Restablecer tu contraseña',
    html: `
      <p>Hola ${esc(opts.firstName)},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p>
        <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Restablecer contraseña
        </a>
      </p>
      <p>Este enlace expira en <strong>15 minutos</strong>.</p>
      <p>Si no solicitaste esto, ignorá este correo.</p>
    `,
  });
}

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  subdomain: string;
  trialDays: number;
}): Promise<void> {
  const loginUrl = `https://${opts.subdomain}.${APP_DOMAIN}/login`;

  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `¡Bienvenido a tu inmobiliaria! Trial de ${opts.trialDays} días activo`,
    html: `
      <p>Hola ${esc(opts.firstName)},</p>
      <p>Tu inmobiliaria está lista. Tenés <strong>${opts.trialDays} días</strong> de prueba gratuita.</p>
      <p>
        <a href="${loginUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Acceder a mi cuenta
        </a>
      </p>
    `,
  });
}

export async function sendTrialExpiringEmail(opts: {
  to: string;
  firstName: string;
  subdomain: string;
  daysLeft: number;
}): Promise<void> {
  const billingUrl = `https://${opts.subdomain}.${APP_DOMAIN}/settings/billing`;

  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `Tu trial vence en ${opts.daysLeft} día${opts.daysLeft === 1 ? '' : 's'}`,
    html: `
      <p>Hola ${esc(opts.firstName)},</p>
      <p>Tu período de prueba vence en <strong>${opts.daysLeft} día${opts.daysLeft === 1 ? '' : 's'}</strong>.</p>
      <p>Elegí un plan para continuar usando tu inmobiliaria sin interrupciones.</p>
      <p>
        <a href="${billingUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Ver planes
        </a>
      </p>
    `,
  });
}

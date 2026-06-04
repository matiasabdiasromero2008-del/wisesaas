import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "wissesaas@gmail.com")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")  # App Password de Gmail
FROM_EMAIL = os.environ.get("FROM_EMAIL", "wissesaas@gmail.com")
FROM_NAME = os.environ.get("FROM_NAME", "WISE ERP")


def _send(to_email: str, subject: str, html_body: str):
    """Envía un correo HTML usando Gmail SMTP."""
    if not SMTP_PASSWORD:
        print(f"[EMAIL] SMTP_PASSWORD no configurado. Se omite el envío a {to_email}.")
        print(f"[EMAIL] Asunto: {subject}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = to_email

    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(FROM_EMAIL, to_email, msg.as_string())
        print(f"[EMAIL] Correo enviado a {to_email}: {subject}")
    except Exception as e:
        print(f"[EMAIL] Error al enviar correo a {to_email}: {e}")


def send_welcome_email(to_email: str, instance_name: str, username: str, password: str):
    """
    Envía las credenciales de acceso al administrador de una nueva instancia.
    """
    subject = f"¡Bienvenido a WISE! Tus credenciales para {instance_name}"
    html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; margin: 0; padding: 0; }}
        .container {{ max-width: 560px; margin: 40px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; }}
        .header {{ background: linear-gradient(135deg, #1d4ed8, #7c3aed); padding: 36px 40px; text-align: center; }}
        .header svg {{ width: 120px; height: auto; }}
        .body {{ padding: 36px 40px; color: #e2e8f0; }}
        h1 {{ color: #f8fafc; font-size: 1.4rem; margin: 0 0 8px; }}
        p {{ color: #94a3b8; line-height: 1.6; margin: 0 0 16px; }}
        .credentials {{ background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 20px 24px; margin: 24px 0; }}
        .cred-row {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }}
        .cred-row:last-child {{ margin-bottom: 0; }}
        .cred-label {{ font-size: 0.8rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }}
        .cred-value {{ font-family: monospace; font-size: 1.05rem; color: #60a5fa; font-weight: 700; }}
        .warning {{ background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; padding: 12px 16px; font-size: 0.85rem; color: #fca5a5; }}
        .footer {{ padding: 20px 40px; text-align: center; font-size: 0.75rem; color: #475569; border-top: 1px solid #334155; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <svg viewBox="0 0 320 80" xmlns="http://www.w3.org/2000/svg">
            <path d="M25,56 L52,40 L62,45 L35,61 Z" fill="white" opacity="0.9"/>
            <path d="M47,47 L78,28 L88,33 L57,52 Z" fill="white" opacity="0.7"/>
            <path d="M72,37 L108,15 L118,20 L82,42 Z" fill="white" opacity="0.5"/>
            <text x="135" y="54" fill="white" font-family="Arial" font-weight="800" font-size="44" letter-spacing="-1">WISE</text>
          </svg>
        </div>
        <div class="body">
          <h1>¡Tu instancia está lista!</h1>
          <p>Se ha creado la instancia <strong style="color:#f8fafc;">{instance_name}</strong> en WISE ERP. A continuación encontrarás tus credenciales de administrador:</p>
          <div class="credentials">
            <div class="cred-row">
              <span class="cred-label">Usuario</span>
              <span class="cred-value">{username}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Contraseña</span>
              <span class="cred-value">{password}</span>
            </div>
          </div>
          <div class="warning">
            ⚠️ Por seguridad, cambiá tu contraseña luego de tu primer inicio de sesión. Guardá estas credenciales en un lugar seguro.
          </div>
          <p style="margin-top:24px;">Si tenés alguna consulta, respondé este correo y te ayudaremos a la brevedad.</p>
        </div>
        <div class="footer">
          © 2025 WISE ERP · wissesaas@gmail.com
        </div>
      </div>
    </body>
    </html>
    """
    _send(to_email, subject, html)


def send_reset_email(to_email: str, username: str, reset_token: str, base_url: str = ""):
    """
    Envía el link de reset de contraseña al usuario.
    """
    reset_link = f"{base_url}/reset-password?token={reset_token}"
    subject = "WISE ERP – Restablecer contraseña"
    html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; margin: 0; padding: 0; }}
        .container {{ max-width: 560px; margin: 40px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; }}
        .header {{ background: linear-gradient(135deg, #1d4ed8, #7c3aed); padding: 36px 40px; text-align: center; }}
        .body {{ padding: 36px 40px; color: #e2e8f0; }}
        h1 {{ color: #f8fafc; font-size: 1.4rem; margin: 0 0 8px; }}
        p {{ color: #94a3b8; line-height: 1.6; margin: 0 0 16px; }}
        .btn {{ display: inline-block; background: linear-gradient(135deg, #1d4ed8, #7c3aed); color: white !important; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 0.95rem; margin: 20px 0; }}
        .token-box {{ background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 0.9rem; color: #60a5fa; word-break: break-all; margin: 12px 0; }}
        .warning {{ font-size: 0.8rem; color: #64748b; }}
        .footer {{ padding: 20px 40px; text-align: center; font-size: 0.75rem; color: #475569; border-top: 1px solid #334155; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <svg viewBox="0 0 320 80" xmlns="http://www.w3.org/2000/svg">
            <path d="M25,56 L52,40 L62,45 L35,61 Z" fill="white" opacity="0.9"/>
            <path d="M47,47 L78,28 L88,33 L57,52 Z" fill="white" opacity="0.7"/>
            <path d="M72,37 L108,15 L118,20 L82,42 Z" fill="white" opacity="0.5"/>
            <text x="135" y="54" fill="white" font-family="Arial" font-weight="800" font-size="44" letter-spacing="-1">WISE</text>
          </svg>
        </div>
        <div class="body">
          <h1>Restablecer contraseña</h1>
          <p>Hola <strong style="color:#f8fafc;">{username}</strong>, recibimos una solicitud para restablecer tu contraseña en WISE ERP.</p>
          <p>Hacé clic en el botón de abajo para crear una nueva contraseña. El enlace expira en <strong>1 hora</strong>.</p>
          <div style="text-align:center;">
            <a href="{reset_link}" class="btn">RESTABLECER CONTRASEÑA</a>
          </div>
          <p class="warning">Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>
          <div class="token-box">{reset_link}</div>
          <p class="warning">Si no solicitaste este cambio, podés ignorar este correo.</p>
        </div>
        <div class="footer">
          © 2025 WISE ERP · wissesaas@gmail.com
        </div>
      </div>
    </body>
    </html>
    """
    _send(to_email, subject, html)

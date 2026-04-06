const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (to, subject, html) => {
  try {
    console.log("📨 Attempting to send email to:", to);

    await transporter.verify();
    console.log("✅ Gmail transporter verified");

    const info = await transporter.sendMail({
      from: `"Hotel Management" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log("✅ Email sent:", info.response);
    return info;
  } catch (error) {
    console.error("❌ EMAIL FAILED:", error.message);
    throw error;
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildLuxuryEmailShell = ({
  eyebrow,
  title,
  intro,
  details,
  actionLabel,
  actionHref,
  footerNote,
}) => `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4efe6; margin: 0; padding: 32px 16px; color: #2d2004;">
  <div style="max-width: 640px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(176,141,87,0.25); border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(32, 22, 4, 0.12);">
    <div style="background: linear-gradient(135deg, #18140d 0%, #2d220f 100%); padding: 32px 40px; border-bottom: 4px solid #b48a2c;">
      <p style="margin: 0 0 8px; color: #e2c98c; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700;">${eyebrow}</p>
      <h2 style="margin: 0; color: #ffffff; font-size: 28px; line-height: 1.2; font-weight: 700;">${title}</h2>
    </div>

    <div style="padding: 32px 40px;">
      <p style="margin: 0 0 24px; color: #6b5a3a; font-size: 15px; line-height: 1.7;">${intro}</p>

      <div style="background: #fbf7f0; border: 1px solid rgba(176,141,87,0.18); border-radius: 14px; padding: 24px; margin-bottom: 24px;">
        ${details}
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <a
          href="${actionHref}"
          style="display: inline-block; padding: 14px 28px; background-color: #b48a2c; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 10px; box-shadow: 0 10px 24px rgba(180,138,44,0.24);"
        >
          ${actionLabel}
        </a>
      </div>

      <div style="border-left: 4px solid #b48a2c; background: rgba(180,138,44,0.06); border-radius: 0 14px 14px 0; padding: 20px 22px;">
        <p style="margin: 0 0 10px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6a30; font-weight: 700;">Important</p>
        <p style="margin: 0 0 10px; font-size: 15px; line-height: 1.8; color: #3a2a10;">${footerNote}</p>
        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #6b5a3a;">If you did not expect this invitation, you can safely ignore this email.</p>
      </div>
    </div>
  </div>
</div>
`;

/*
  Corporate Admin Invitation Email
*/
const sendCorporateAdminInvite = async (
  email,
  name,
  inviteLink,
  organizationName,
) => {
  const subject = "You're Invited to Join Luxury HMS";
  const html = buildLuxuryEmailShell({
    eyebrow: "HotelOS Invitation Desk",
    title: "Welcome to Luxury HMS",
    intro: `Hello <strong style="color: #2d2004;">${escapeHtml(name)}</strong>, you have been invited to join the organization below as a Corporate Administrator.`,
    details: `
      <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Organization:</strong> ${escapeHtml(organizationName)}</p>
      <p style="margin: 0; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Role:</strong> Corporate Administrator</p>
    `,
    actionLabel: "Activate Your Account",
    actionHref: inviteLink,
    footerNote: "This invitation link will expire in 10 minutes.",
  });

  return sendEmail(email, subject, html);
};

/*
  🔹 Generic Invitation Email (Branch Manager / Other Roles)
*/
const sendInvitationEmail = async (
  email,
  name,
  role,
  inviteLink,
  organizationName,
  branchName = null
) => {
  const subject = "You're Invited to Join Luxury HMS";
  const html = buildLuxuryEmailShell({
    eyebrow: "HotelOS Invitation Desk",
    title: "Welcome to Luxury HMS",
    intro: `Hello <strong style="color: #2d2004;">${escapeHtml(name)}</strong>, you have been invited to join the organization below.`,
    details: `
      <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Organization:</strong> ${escapeHtml(organizationName)}</p>
      ${branchName ? `<p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Branch:</strong> ${escapeHtml(branchName)}</p>` : ""}
      <p style="margin: 0; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Role:</strong> ${escapeHtml(role)}</p>
    `,
    actionLabel: "Accept Invitation",
    actionHref: inviteLink,
    footerNote: "This invitation link will expire in 10 minutes.",
  });

  return sendEmail(email, subject, html);
};

const sendContactEmail = async ({ name, email, phone, message }) => {
  const subject = "New Contact Form Submission";
  const contactRecipient = process.env.CONTACT_EMAIL || process.env.EMAIL_USER;

  const html = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4efe6; margin: 0; padding: 32px 16px; color: #2d2004;">
  <div style="max-width: 640px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(176,141,87,0.25); border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(32, 22, 4, 0.12);">
    <div style="background: linear-gradient(135deg, #18140d 0%, #2d220f 100%); padding: 32px 40px; border-bottom: 4px solid #b48a2c;">
      <p style="margin: 0 0 8px; color: #e2c98c; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700;">HotelOS Contact Desk</p>
      <h2 style="margin: 0; color: #ffffff; font-size: 28px; line-height: 1.2; font-weight: 700;">New Contact Request</h2>
    </div>

    <div style="padding: 32px 40px;">
      <p style="margin: 0 0 24px; color: #6b5a3a; font-size: 15px; line-height: 1.7;">
        A visitor submitted the website contact form. Their details are below.
      </p>

      <div style="background: #fbf7f0; border: 1px solid rgba(176,141,87,0.18); border-radius: 14px; padding: 24px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Name:</strong> ${escapeHtml(name)}</p>
        <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin: 0; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Phone:</strong> ${escapeHtml(phone)}</p>
      </div>

      <div style="border-left: 4px solid #b48a2c; background: rgba(180,138,44,0.06); border-radius: 0 14px 14px 0; padding: 20px 22px;">
        <p style="margin: 0 0 10px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6a30; font-weight: 700;">Message</p>
        <p style="margin: 0; font-size: 15px; line-height: 1.8; color: #3a2a10; white-space: pre-wrap;">${escapeHtml(message)}</p>
      </div>
    </div>
  </div>
</div>
`;

  return sendEmail(contactRecipient, subject, html);
};

const sendPasswordResetOtpEmail = async (email, otp) => {
  const subject = "Your Luxury HMS password reset code";
  const html = buildLuxuryEmailShell({
    eyebrow: "HotelOS Security Desk",
    title: "Password Reset Verification",
    intro:
      "Use the one-time password below to reset your Luxury HMS account password.",
    details: `
      <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;">Your verification code is:</p>
      <p style="margin: 0; font-size: 32px; letter-spacing: 8px; font-weight: 700; color: #b48a2c; text-align: center;">${escapeHtml(otp)}</p>
    `,
    actionLabel: "Open Luxury HMS",
    actionHref: process.env.FRONTEND_URL || "http://localhost:8080/login",
    footerNote: "This OTP expires in 5 minutes. Do not share it with anyone.",
  });

  return sendEmail(email, subject, html);
};

module.exports = {
  sendEmail,
  sendCorporateAdminInvite,
  sendInvitationEmail,
  sendContactEmail,
  sendPasswordResetOtpEmail,
};

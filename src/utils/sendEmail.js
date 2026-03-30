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

  const html = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; padding: 40px 20px; line-height: 1.6; color: #3f3f46;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border: 1px solid #e4e4e7;">
    
    <div style="background: linear-gradient(135deg, #18181b 0%, #27272a 100%); padding: 32px 40px; text-align: center; border-bottom: 4px solid #b08d57;">
      <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Welcome to Luxury HMS</h2>
    </div>

    <div style="padding: 40px;">
      <p style="margin-top: 0; font-size: 16px; color: #52525b;">Hello <b style="color: #18181b;">${name}</b>,</p>

      <p style="font-size: 16px; color: #52525b;">You have been invited to join the organization:</p>

      <div style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 12px 0; font-size: 16px;"><b style="color: #18181b;">Organization:</b> <span style="color: #52525b;">${organizationName}</span></p>
        <p style="margin: 0; font-size: 16px;"><b style="color: #18181b;">Role:</b> <span style="color: #52525b;">Corporate Administrator</span></p>
      </div>

      <p style="font-size: 16px; color: #52525b;">Click the button below to activate your account:</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteLink}"
           style="
             display: inline-block;
             padding: 14px 28px;
             background-color: #b08d57;
             color: #ffffff;
             text-decoration: none;
             font-weight: 600;
             font-size: 16px;
             border-radius: 8px;
             box-shadow: 0 4px 6px rgba(176, 141, 87, 0.25);
             text-align: center;
           ">
           Activate Your Account
        </a>
      </div>

      <p style="margin-top: 20px; font-size: 14px; color: #71717a;">
        This link will expire in <b style="color: #3f3f46;">10 minutes</b>.
      </p>

      <p style="font-size: 14px; color: #71717a;">If you did not expect this invitation, you can ignore this email.</p>

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e4e7;">
        <p style="font-size: 15px; font-weight: 600; color: #18181b; margin: 0;">Luxury HMS Team</p>
      </div>
    </div>
  </div>
</div>
`;

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

  const html = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; padding: 40px 20px; line-height: 1.6; color: #3f3f46;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border: 1px solid #e4e4e7;">
    
    <div style="background: linear-gradient(135deg, #18181b 0%, #27272a 100%); padding: 32px 40px; text-align: center; border-bottom: 4px solid #b08d57;">
      <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Welcome to Luxury HMS</h2>
    </div>

    <div style="padding: 40px;">
      <p style="margin-top: 0; font-size: 16px; color: #52525b;">Hello <b style="color: #18181b;">${name}</b>,</p>

      <p style="font-size: 16px; color: #52525b;">You have been invited to join the organization:</p>

      <div style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 12px 0; font-size: 16px;"><b style="color: #18181b;">Organization:</b> <span style="color: #52525b;">${organizationName}</span></p>
        ${branchName ? `<p style="margin: 0 0 12px 0; font-size: 16px;"><b style="color: #18181b;">Branch:</b> <span style="color: #52525b;">${branchName}</span></p>` : ""}
        <p style="margin: 0; font-size: 16px;"><b style="color: #18181b;">Role:</b> <span style="color: #52525b;">${role}</span></p>
      </div>

      <p style="font-size: 16px; color: #52525b;">Click the button below to accept your invitation:</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteLink}"
           style="
             display: inline-block;
             padding: 14px 28px;
             background-color: #b08d57;
             color: #ffffff;
             text-decoration: none;
             font-weight: 600;
             font-size: 16px;
             border-radius: 8px;
             box-shadow: 0 4px 6px rgba(176, 141, 87, 0.25);
             text-align: center;
           ">
           Accept Invitation
        </a>
      </div>

      <p style="margin-top: 20px; font-size: 14px; color: #71717a;">
        This link will expire in <b style="color: #3f3f46;">10 minutes</b>.
      </p>

      <p style="font-size: 14px; color: #71717a;">If you did not expect this invitation, you can ignore this email.</p>

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e4e7;">
        <p style="font-size: 15px; font-weight: 600; color: #18181b; margin: 0;">Luxury HMS Team</p>
      </div>
    </div>
  </div>
</div>
`;

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

module.exports = {
  sendEmail,
  sendCorporateAdminInvite,
  sendInvitationEmail,
  sendContactEmail,
};

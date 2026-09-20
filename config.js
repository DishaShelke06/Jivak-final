const path = require('path');

module.exports = {
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'clinic.db'),
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-in-production',
  DOCTOR_USERNAME: process.env.DOCTOR_USERNAME || 'doctor',
  DOCTOR_PASSWORD: process.env.DOCTOR_PASSWORD || 'clinic123',
  DOCTOR_NAME: process.env.DOCTOR_NAME || 'Doctor',
  PORT: Number(process.env.PORT) || 5000,
  TWILIO_SID: process.env.TWILIO_SID || '',
  TWILIO_TOKEN: process.env.TWILIO_TOKEN || '',
  TWILIO_WA_FROM: process.env.TWILIO_WA_FROM || 'whatsapp:+14155238886',
  TWILIO_SMS_FROM: process.env.TWILIO_SMS_FROM || '',
  CLINIC_PHONE: process.env.CLINIC_PHONE || '',
};

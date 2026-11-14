export function maskPhone(phone) {
  return phone && phone.length >= 7 ? `${phone.slice(0, 5)}***${phone.slice(-3)}` : "***";
}

export function maskEmail(email) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

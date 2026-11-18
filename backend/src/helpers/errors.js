// მხოლოდ UserError-ის ტექსტი ჩანს მომხმარებლისთვის. დანარჩენი შეცდომები ლოგში იწერება და ზოგად შეტყობინებად გადადის
class UserError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
module.exports = { UserError };

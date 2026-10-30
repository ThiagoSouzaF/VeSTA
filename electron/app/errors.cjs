// An error whose message is written for the person using the app (Portuguese, no paths, no stack, no secrets).
// The remote server forwards its message to the phone; any other Error only gets a generic answer there and its
// detail stays in the local log. Use it for validation and state rules ("Aguarde a resposta terminar…"), never for
// failures that carry system detail (ENOENT, stderr of a CLI, HTTP bodies).
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.userSafe = true;
  }
}
// Duck-typed so the pure modules shared with the renderers (which cannot require this file) can raise one too.
const isUserError = (e) => e instanceof UserError || e?.userSafe === true;
module.exports = { UserError, isUserError };

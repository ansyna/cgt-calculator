package com.cgtcalculator.platform.account;


import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.cgtcalculator.platform.auth.AuthController.AuthResponse;
import com.cgtcalculator.platform.auth.AuthController.CurrentUser;
import com.cgtcalculator.platform.auth.RequestLimits;
import com.cgtcalculator.platform.user.User;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Forgotten passwords, email confirmation and accepting an invitation (Laravel's Auth::routes()). */
@RestController
@RequestMapping("/api/auth")
public class AccountController {

    /** A message to show, e.g. that a reset link is on its way. */
    public record MessageResponse(String message) {
    }

    /** Who an invitation is for. */
    public record InvitationResponse(String name, String email) {
    }

    public record ForgotRequest(@NotBlank @Email @Size(max = 255) String email) {
    }

    public record NewPasswordRequest(@NotBlank @Size(max = 255) String token, @NotBlank @Size(max = 255) String password,
                                     @NotBlank @Size(max = 255) String passwordConfirmation) {
    }

    public record TokenRequest(@NotBlank @Size(max = 255) String token) {
    }

    public record AcceptInvitation(@NotBlank @Size(max = 255) String token, @NotBlank @Size(max = 255) String name,
                                   @NotBlank @Size(max = 255) String password, @NotBlank @Size(max = 255) String passwordConfirmation) {
    }

    private static final String MISMATCH = "The password confirmation does not match.";

    static final String RESET_SENT = "If an account exists for that email, we've sent a link to reset its password.";

    private final AccountService accounts;
    private final SessionService sessions;
    private final RequestLimits limits;

    public AccountController(AccountService accounts, SessionService sessions, RequestLimits limits) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.limits = limits;
    }

    /** Emails a reset link. The answer is the same whether or not the account exists. */
    @PostMapping("/password/forgot")
    public MessageResponse forgotPassword(@Valid @RequestBody ForgotRequest request, HttpServletRequest http) {
        limits.resetRequest(http.getRemoteAddr(), request.email().trim());
        accounts.requestPasswordReset(request.email());
        return new MessageResponse(RESET_SENT);
    }

    @PostMapping("/password/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@Valid @RequestBody NewPasswordRequest request) {
        Passwords.validate(request.password(), request.passwordConfirmation(), MISMATCH);
        accounts.resetPassword(request.token(), request.password());
    }

    @PostMapping("/email/verify")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verifyEmail(@Valid @RequestBody TokenRequest request) {
        accounts.verifyEmail(request.token());
    }

    /** Sends the confirmation link again to the logged-in user. */
    @PostMapping("/email/resend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resendVerification(@AuthenticationPrincipal Jwt jwt) {
        accounts.resendVerification(Long.valueOf(jwt.getSubject()));
    }

    /** Who an invitation is for, to greet them on the page. */
    @GetMapping("/invitation")
    public InvitationResponse invitation(@RequestParam String token) {
        User user = accounts.invited(token);
        return new InvitationResponse(user.getName(), user.getEmail());
    }

    /** Sets the invited user's name and password, and logs them in. */
    @PostMapping("/invitation/accept")
    public AuthResponse acceptInvitation(@Valid @RequestBody AcceptInvitation request, HttpServletResponse response) {
        Passwords.validate(request.password(), request.passwordConfirmation(), MISMATCH);
        User user = accounts.acceptInvitation(request.token(), request.name(), request.password());
        return new AuthResponse(sessions.start(user, response), CurrentUser.of(user));
    }
}

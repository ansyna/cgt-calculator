package com.cgtcalculator.platform.account;

import java.time.Clock;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.cgtcalculator.platform.account.AccountEmails.Delivery;
import com.cgtcalculator.platform.account.OneTimeToken.Purpose;
import com.cgtcalculator.platform.auth.RequestLimits;
import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;
import com.cgtcalculator.platform.web.ApiExceptionHandler.BadRequestException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

/**
 * Your own account: logging in, signing up, forgotten passwords, confirming the email address and accepting an
 * invitation. Each is one transaction; emails go out after it (in the background), never while it holds a database
 * connection. Limits and sessions (cookies) stay with the controllers.
 */
@Service
@Transactional
public class AccountService {

    private final UserRepository users;
    private final OneTimeTokenService tokens;
    private final AccountEmails emails;
    private final SessionService sessions;
    private final ActivityService activity;
    private final PasswordEncoder passwordEncoder;
    private final RequestLimits limits;
    private final Clock clock;

    public AccountService(UserRepository users, OneTimeTokenService tokens, AccountEmails emails, SessionService sessions,
                          ActivityService activity, PasswordEncoder passwordEncoder, RequestLimits limits, Clock clock) {
        this.users = users;
        this.tokens = tokens;
        this.emails = emails;
        this.sessions = sessions;
        this.activity = activity;
        this.passwordEncoder = passwordEncoder;
        this.limits = limits;
        this.clock = clock;
    }

    /** The account with this email and password; empty when there is none (or it is an unaccepted invitation). */
    @Transactional(readOnly = true)
    public Optional<User> authenticate(String email, String password) {
        return users.findByEmailIgnoreCase(email.trim())
                .filter(u -> !u.isInvitationPending())
                // a password bcrypt can't check can't be anyone's
                .filter(u -> Passwords.fits(password) && passwordEncoder.matches(password, u.getPassword()));
    }

    /** A new account waiting for approval; asked to confirm its address when the app can send the link. */
    public User register(String name, String email, String password) {
        String address = email.trim();
        if (users.existsByEmailIgnoreCase(address)) {
            throw new ValidationException("email", "The email has already been taken.");
        }
        User user = new User(name.trim(), address, passwordEncoder.encode(password));
        user.setVerificationRequired(emails.enabled());
        user = users.save(user);
        if (emails.enabled()) {
            emails.verification(user, Delivery.LATER);
            emails.newSignUp(user);
        }
        activity.record("register", user.getEmail(), user.getEmail(), "Signed up; waiting for approval");
        return user;
    }

    /** Emails a reset link if the account exists; the caller answers the same either way. */
    public void requestPasswordReset(String email) {
        if (!emails.enabled()) {
            throw new BadRequestException("Email isn't set up on this site: please ask the admin for a password reset link.");
        }
        String address = email.trim();
        users.findByEmailIgnoreCase(address).filter(u -> !u.isInvitationPending()).ifPresentOrElse(user -> {
            // sent after the answer, which therefore takes as long whether or not the account exists
            emails.passwordReset(user, Delivery.LATER);
            activity.record("password.reset-requested", "", user.getEmail(), "Reset link emailed");
        }, () -> activity.record("password.reset-requested", "", address, "No such account: nothing sent"));
    }

    public void resetPassword(String token, String password) {
        User user = tokens.redeem(token, Purpose.PASSWORD_RESET);
        user.setPassword(passwordEncoder.encode(password));
        // whoever had the old password is logged out everywhere
        sessions.endAll(user);
        activity.record("password.reset", user.getEmail(), user.getEmail(), "New password set with a reset link");
    }

    public void verifyEmail(String token) {
        User user = tokens.redeem(token, Purpose.EMAIL_VERIFICATION);
        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(clock.instant());
        }
        activity.record("email.verified", user.getEmail(), user.getEmail(), "");
    }

    /** Sends the confirmation link again, unless the address is confirmed already. */
    public void resendVerification(Long userId) {
        User user = users.findById(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        if (user.isEmailVerified()) {
            return;
        }
        if (!emails.enabled()) {
            throw new BadRequestException("Email isn't set up on this site.");
        }
        limits.verificationRequest(user.getEmail());
        emails.verification(user, Delivery.LATER);
    }

    @Transactional(readOnly = true)
    public User invited(String token) {
        return tokens.peek(token, Purpose.INVITATION);
    }

    /** Sets the invited person's name and password; the admin chose the address, so it counts as confirmed. */
    public User acceptInvitation(String token, String name, String password) {
        User user = tokens.redeem(token, Purpose.INVITATION);
        user.setName(name.trim());
        user.setPassword(passwordEncoder.encode(password));
        user.setInvitationPending(false);
        user.setEmailVerifiedAt(clock.instant());
        activity.record("invitation.accepted", user.getEmail(), user.getEmail(), "");
        return user;
    }
}

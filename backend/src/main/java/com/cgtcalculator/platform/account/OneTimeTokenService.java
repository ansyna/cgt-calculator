package com.cgtcalculator.platform.account;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.cgtcalculator.platform.account.OneTimeToken.Purpose;
import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.web.ApiExceptionHandler.BadRequestException;

/** Issues and redeems single-use link tokens. A new token cancels the user's earlier unused ones of the same kind. */
@Service
public class OneTimeTokenService {

    static final Duration PASSWORD_RESET_TTL = Duration.ofHours(1);
    static final Duration EMAIL_VERIFICATION_TTL = Duration.ofDays(2);
    static final Duration INVITATION_TTL = Duration.ofDays(7);

    private final OneTimeTokenRepository repository;
    private final Clock clock;

    public OneTimeTokenService(OneTimeTokenRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /** @return the token to put in the link (shown once, never stored) */
    @Transactional
    public String issue(User user, Purpose purpose) {
        Instant now = clock.instant();
        repository.findByUserAndPurposeAndUsedAtIsNull(user, purpose).forEach(old -> old.markUsed(now));
        String token = Tokens.random();
        repository.save(new OneTimeToken(user, purpose, Tokens.hash(token), now, now.plus(ttl(purpose))));
        return token;
    }

    /** The user the token was issued to, without using it up; fails for an unknown, used or expired token. */
    @Transactional(readOnly = true)
    public User peek(String token, Purpose purpose) {
        return valid(token, purpose).getUser();
    }

    /** Uses the token up and returns its user. */
    @Transactional
    public User redeem(String token, Purpose purpose) {
        OneTimeToken found = valid(token, purpose);
        found.markUsed(clock.instant());
        return found.getUser();
    }

    private OneTimeToken valid(String token, Purpose purpose) {
        OneTimeToken found = token == null || token.isBlank() ? null
                : repository.findByTokenHash(Tokens.hash(token)).filter(t -> t.getPurpose() == purpose).orElse(null);
        if (found == null || found.getUsedAt() != null || !found.getExpiresAt().isAfter(clock.instant())) {
            throw new BadRequestException(switch (purpose) {
                case PASSWORD_RESET -> "This password reset link is invalid or has expired. Please ask for a new one.";
                case EMAIL_VERIFICATION -> "This verification link is invalid or has expired. Please ask for a new one.";
                case INVITATION -> "This invitation is invalid or has expired. Please ask the admin for a new one.";
            });
        }
        return found;
    }

    static Duration ttl(Purpose purpose) {
        return switch (purpose) {
            case PASSWORD_RESET -> PASSWORD_RESET_TTL;
            case EMAIL_VERIFICATION -> EMAIL_VERIFICATION_TTL;
            case INVITATION -> INVITATION_TTL;
        };
    }
}

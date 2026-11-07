package com.cgtcalculator.platform.account;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import org.springframework.stereotype.Service;

import com.cgtcalculator.platform.account.OneTimeToken.Purpose;
import com.cgtcalculator.platform.user.Role;
import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;

/** The account emails, with their single-use links. */
@Service
public class AccountEmails {

    /**
     * A link for the user: {@code path} always, {@code url} when the app's address is known, and whether it was
     * emailed. Admins can copy it and send it themselves.
     */
    public record Link(String path, String url, boolean emailed) {
    }

    /**
     * How a link is sent: {@code NOW} when an admin waits to know whether it went out; {@code LATER} (in the
     * background, after the transaction) for anything someone not logged in can trigger.
     */
    public enum Delivery {
        NOW, LATER
    }

    private static final String SITE = "CGT Calculator";

    private final OneTimeTokenService tokens;
    private final Mailer mailer;
    private final UserRepository users;

    public AccountEmails(OneTimeTokenService tokens, Mailer mailer, UserRepository users) {
        this.tokens = tokens;
        this.mailer = mailer;
        this.users = users;
    }

    public boolean enabled() {
        return mailer.isEnabled();
    }

    public Link passwordReset(User user, Delivery delivery) {
        String path = path("/reset-password", tokens.issue(user, Purpose.PASSWORD_RESET));
        String url = url(path);
        boolean sent = send(delivery, user.getEmail(), SITE + ": reset your password", """
                Hi %s,

                Someone (hopefully you) asked to reset the password of your %s account.
                Choose a new password here (the link works once, for an hour):

                %s

                If you didn't ask for this, ignore this email: your password stays the same.
                """.formatted(user.getName(), SITE, url));
        return new Link(path, url, sent);
    }

    public Link verification(User user, Delivery delivery) {
        String path = path("/verify-email", tokens.issue(user, Purpose.EMAIL_VERIFICATION));
        String url = url(path);
        boolean sent = send(delivery, user.getEmail(), SITE + ": confirm your email address", """
                Hi %s,

                Please confirm that this is your email address (the link works for 2 days):

                %s
                """.formatted(user.getName(), url));
        return new Link(path, url, sent);
    }

    public Link invitation(User user, String invitedBy) {
        String path = path("/accept-invite", tokens.issue(user, Purpose.INVITATION));
        String url = url(path);
        boolean sent = mailer.send(user.getEmail(), invitedBy + " invited you to " + SITE, """
                Hi %s,

                %s invited you to %s, a tool for analysing companies' financial statements.
                Choose your password to get started (the link works for 7 days):

                %s
                """.formatted(user.getName(), invitedBy, SITE, url));
        return new Link(path, url, sent);
    }

    public void approved(User user) {
        mailer.sendLater(user.getEmail(), SITE + ": your account is ready", """
                Hi %s,

                An admin gave you access to the calculator. You can log in now:

                %s
                """.formatted(user.getName(), url("/login")));
    }

    /** Tells the admins about a new sign-up waiting for approval. */
    public void newSignUp(User user) {
        for (User admin : users.findAll()) {
            if (admin.hasRole(Role.ADMIN)) {
                mailer.sendLater(admin.getEmail(), SITE + ": " + user.getName() + " signed up", """
                        %s (%s) created an account and is waiting for access.
                        Approve or reject it under Users:

                        %s
                        """.formatted(user.getName(), user.getEmail(), url("/users")));
            }
        }
    }

    private boolean send(Delivery delivery, String to, String subject, String text) {
        return delivery == Delivery.NOW ? mailer.send(to, subject, text) : mailer.sendLater(to, subject, text);
    }

    private static String path(String page, String token) {
        return page + "?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8);
    }

    private String url(String path) {
        String base = mailer.baseUrl();
        return base.isEmpty() ? null : base + path;
    }
}

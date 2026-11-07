package com.cgtcalculator.platform.account;

import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.cgtcalculator.platform.auth.LimitProperties;
import com.cgtcalculator.platform.auth.RateLimiter;

import jakarta.annotation.PreDestroy;

/**
 * Sends the app's emails through the SMTP server in MAIL_HOST / MAIL_PORT / MAIL_USERNAME / MAIL_PASSWORD.
 * Without one (or without the app's public address for links), email is off: admins copy links instead.
 * <p>
 * No address gets more than {@code app.limits.emails-per-recipient-per-day} emails a day, so scripts can't use the
 * app to flood someone's inbox or use up the mail account's daily quota.
 */
@Component
public class Mailer {

    private static final Logger log = LoggerFactory.getLogger(Mailer.class);
    /** Emails waiting to be sent in the background; more are dropped (and logged) rather than piling up. */
    private static final int QUEUE = 100;

    private final JavaMailSender sender;
    private final AccountProperties properties;
    private final RateLimiter perRecipient;
    // one thread: SMTP servers limit connections, and nothing waits for these emails
    private final ThreadPoolExecutor background = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(QUEUE), runnable -> {
                Thread thread = new Thread(runnable, "mail");
                thread.setDaemon(true);
                return thread;
            }, (task, executor) -> log.warn("Too many emails waiting: one was dropped"));

    public Mailer(ObjectProvider<JavaMailSender> sender, AccountProperties properties, LimitProperties limits, Clock clock) {
        this.sender = sender.getIfAvailable();
        this.properties = properties;
        this.perRecipient = new RateLimiter(limits.emailsPerRecipientPerDay(), Duration.ofDays(1), clock);
    }

    public boolean isEnabled() {
        boolean hasHost = sender instanceof JavaMailSenderImpl impl ? impl.getHost() != null && !impl.getHost().isBlank() : sender != null;
        return hasHost && !baseUrl().isEmpty();
    }

    /** The app's public address, for links ("" when unknown). */
    public String baseUrl() {
        String url = properties.baseUrl() == null ? "" : properties.baseUrl().trim();
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    /**
     * Sends now, for an admin who wants to know whether the email went out.
     *
     * @return whether the email was handed to the SMTP server
     */
    public boolean send(String to, String subject, String text) {
        return isEnabled() && allowed(to, subject) && deliver(to, subject, text);
    }

    /**
     * Sends in the background once the current transaction commits (at once without one), so a slow SMTP server
     * holds neither the request nor a database connection, and nothing is sent for a change that was rolled back.
     *
     * @return whether the email was queued
     */
    public boolean sendLater(String to, String subject, String text) {
        if (!isEnabled() || !allowed(to, subject)) {
            return false;
        }
        Map<String, String> context = MDC.getCopyOfContextMap();
        Runnable task = () -> {
            if (context != null) MDC.setContextMap(context);
            try {
                deliver(to, subject, text);
            } finally {
                MDC.clear();
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runInBackground(task);
                }
            });
        } else {
            runInBackground(task);
        }
        return true;
    }

    /** Hands the email to the SMTP server. */
    protected boolean deliver(String to, String subject, String text) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            if (properties.mailFrom() != null && !properties.mailFrom().isBlank()) {
                message.setFrom(properties.mailFrom());
            }
            message.setTo(to);
            message.setSubject(subject);
            message.setText(text);
            sender.send(message);
            return true;
        } catch (RuntimeException e) {
            log.warn("Could not send \"{}\" to {}: {}", subject, to, e.getMessage());
            return false;
        }
    }

    protected void runInBackground(Runnable task) {
        background.execute(task);
    }

    private boolean allowed(String to, String subject) {
        if (perRecipient.acquire(to.trim().toLowerCase(Locale.ROOT)).allowed()) {
            return true;
        }
        log.warn("Not sending \"{}\" to {}: it had the most emails allowed today", subject, to);
        return false;
    }

    @PreDestroy
    void shutdown() throws InterruptedException {
        background.shutdown();
        background.awaitTermination(10, TimeUnit.SECONDS);
    }
}

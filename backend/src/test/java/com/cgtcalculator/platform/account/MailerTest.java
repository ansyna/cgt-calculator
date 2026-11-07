package com.cgtcalculator.platform.account;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.mail.javamail.JavaMailSender;

import com.cgtcalculator.platform.auth.LimitProperties;

class MailerTest {

    /** Email on, delivered into a list. */
    static final class ListMailer extends Mailer {
        final List<String> sent = new ArrayList<>();
        final List<Runnable> queued = new ArrayList<>();

        ListMailer(int perRecipientPerDay) {
            super(new StaticListableBeanFactory().getBeanProvider(JavaMailSender.class),
                    new AccountProperties("https://screener.example", "", true, 30),
                    new LimitProperties(10, 10, 10, 10, perRecipientPerDay), Clock.systemUTC());
        }

        @Override
        public boolean isEnabled() {
            return true;
        }

        @Override
        protected boolean deliver(String to, String subject, String text) {
            sent.add(to + ": " + subject);
            return true;
        }

        @Override
        protected void runInBackground(Runnable task) {
            queued.add(task);
        }
    }

    @Test
    void noAddressGetsMoreThanItsEmailsADay() {
        ListMailer mailer = new ListMailer(2);
        assertThat(mailer.send("a@example.com", "one", "")).isTrue();
        assertThat(mailer.sendLater("A@example.com", "two", "")).isTrue();
        assertThat(mailer.sendLater("a@example.com", "three", "")).isFalse();
        assertThat(mailer.send("a@example.com", "four", "")).isFalse();
        assertThat(mailer.send("b@example.com", "one", "")).isTrue();
    }

    @Test
    void backgroundEmailsWaitForTheirTurn() {
        ListMailer mailer = new ListMailer(10);
        mailer.sendLater("a@example.com", "later", "");
        assertThat(mailer.sent).isEmpty();
        mailer.queued.forEach(Runnable::run);
        assertThat(mailer.sent).containsExactly("a@example.com: later");
    }
}

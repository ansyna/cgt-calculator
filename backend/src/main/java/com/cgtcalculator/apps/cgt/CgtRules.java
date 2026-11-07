package com.cgtcalculator.apps.cgt;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Month;
import java.util.List;

/**
 * Irish Capital Gains Tax for an individual, as Revenue describes it (Form 11 helpsheet, CG1 helpsheet, Tax and
 * Duty Manual Part 19):
 * <ul>
 * <li>the chargeable gain is taxed at the rate of each disposal's day: 33% from 6 December 2012, 31% from 7 October 2026
 * (Budget 2027); after the year's personal exemption of €1,270, which can't be passed to a spouse;</li>
 * <li>the year's losses, then unused losses of earlier years, are set against the gains before the exemption; in a year
 * with gains at two rates, losses and the exemption go against the higher rate's gains first (the least tax);</li>
 * <li>two payment periods: disposals from 1 January to 30 November are paid by 15 December, December's by 31
 * January; the return (Form 11 or CG1) is due by 31 October of the following year.</li>
 * </ul>
 */
public final class CgtRules {

    /** 33% for disposals up to 6 October 2026, 31% from 7 October 2026 on. */
    public static final BigDecimal RATE_33 = new BigDecimal("0.33");
    public static final BigDecimal RATE_31 = new BigDecimal("0.31");
    public static final LocalDate RATE_31_FROM = LocalDate.of(2026, Month.OCTOBER, 7);
    public static final BigDecimal EXEMPTION = new BigDecimal("1270");
    /** The first tax year wholly at 33% or after; earlier years are calculated but flagged. */
    public static final int FIRST_SUPPORTED_YEAR = 2013;
    /** Shares bought this many days before a sale are matched with it first; and after a sale at a loss, they restrict it. */
    public static final int FOUR_WEEKS = 28;

    private CgtRules() {
    }

    /** The rate of a disposal on that day. */
    public static BigDecimal rate(LocalDate disposal) {
        return disposal.isBefore(RATE_31_FROM) ? RATE_33 : RATE_31;
    }

    /** The rates of a tax year's disposals, the highest first. */
    public static List<BigDecimal> rates(int year) {
        if (year < RATE_31_FROM.getYear()) return List.of(RATE_33);
        if (year == RATE_31_FROM.getYear()) return List.of(RATE_33, RATE_31);
        return List.of(RATE_31);
    }

    /** Whether a disposal falls in the later period (December), paid by 31 January of the next year. */
    public static boolean laterPeriod(LocalDate date) {
        return date.getMonth() == Month.DECEMBER;
    }

    public static LocalDate initialPaymentDue(int year) {
        return LocalDate.of(year, Month.DECEMBER, 15);
    }

    public static LocalDate laterPaymentDue(int year) {
        return LocalDate.of(year + 1, Month.JANUARY, 31);
    }

    public static LocalDate returnDue(int year) {
        return LocalDate.of(year + 1, Month.OCTOBER, 31);
    }
}

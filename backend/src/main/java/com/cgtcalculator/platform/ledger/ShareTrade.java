package com.cgtcalculator.platform.ledger;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Locale;

import org.jspecify.annotations.Nullable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A trade in the user's record of shares: a buy, a sell, or a company's split, read and changed through
 * {@link ShareTradeService}.
 * <p>
 * A trade's amounts are kept as they were entered: by price a share and the day's rate (the CGT calculator's form), or
 * by its total in its currency and in euro (a broker's statement); the other figures are worked out from them.
 */
@Entity
@Table(name = "share_trades")
public class ShareTrade {

    /** A buy, a sell, or a split: its quantity the new shares for each one held, with no amounts. */
    public enum Kind {
        BUY, SELL, SPLIT
    }

    /** Shares (capital gains tax) or an ETF or fund (exit tax). */
    public enum Asset {
        SHARES, ETF
    }

    /** Whose shares they are. */
    public enum Owner {
        YOU, PARTNER, JOINT
    }

    /** How shares bought were acquired: bought, vested (RSU) or bought through an ESPP. */
    public enum Source {
        BUY, RSU, ESPP
    }

    /** Where a trade was entered: the CGT calculator (its form, or a file imported). */
    public enum App {
        CGT
    }

    private static final MathContext MC = MathContext.DECIMAL128;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 5)
    private Kind kind;

    @Column(name = "trade_date", nullable = false)
    private LocalDate date;

    @Column(nullable = false, length = 20)
    private String symbol;

    @Column(length = 100)
    private @Nullable String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Asset asset = Asset.SHARES;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Owner owner = Owner.YOU;

    @Column(nullable = false, precision = 20, scale = 8)
    private BigDecimal quantity;

    /** The trade's total in its currency, before fees. */
    @Column(nullable = false, precision = 30, scale = 12)
    private BigDecimal amount;

    @Column(nullable = false, length = 3)
    private String currency;

    /** Units of the currency per euro on the day; none when it can't be worked out (an amount in one currency only). */
    @Column(name = "eur_rate", precision = 24, scale = 12)
    private @Nullable BigDecimal eurRate;

    /**
     * The ECB's reference rate of its day (units of the currency per euro), and the day it's the ECB's rate of (the last
     * before a weekend or holiday); none until it's looked up.
     */
    @Column(name = "ecb_rate", precision = 24, scale = 12)
    private @Nullable BigDecimal ecbRate;

    @Column(name = "ecb_rate_date")
    private @Nullable LocalDate ecbRateDate;

    /** The trade's total in euro, before fees. */
    @Column(name = "amount_eur", nullable = false, precision = 30, scale = 12)
    private BigDecimal amountEur;

    /** Its fees in its currency, and in euro. */
    @Column(nullable = false, precision = 24, scale = 8)
    private BigDecimal fees = BigDecimal.ZERO;

    @Column(name = "fees_eur", nullable = false, precision = 24, scale = 8)
    private BigDecimal feesEur = BigDecimal.ZERO;

    /** For a sale whose purchase isn't among the trades: what the shares sold cost, in euro, with fees. */
    @Column(name = "cost_eur", precision = 18, scale = 4)
    private @Nullable BigDecimal costEur;

    @Enumerated(EnumType.STRING)
    @Column(length = 10)
    private @Nullable Source source;

    @Column(length = 200)
    private @Nullable String note;

    @Enumerated(EnumType.STRING)
    @Column(name = "entered_in", nullable = false, length = 10)
    private App enteredIn;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ShareTrade() {
    }

    public ShareTrade(Long userId, App enteredIn, Instant now) {
        this.userId = userId;
        this.enteredIn = enteredIn;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * Its day, share and figures by price a share: the total and fees in euro worked out at the rate.
     *
     * @param price   per share, in {@code currency}
     * @param fees    in {@code currency}
     * @param eurRate units of {@code currency} per euro on the day
     */
    public ShareTrade byPrice(Kind kind, LocalDate date, String symbol, BigDecimal quantity, BigDecimal price, String currency, BigDecimal fees,
                              BigDecimal eurRate, Instant now) {
        set(kind, date, symbol, quantity, currency, now);
        this.amount = kept(quantity.multiply(price, MC), 12);
        this.eurRate = kept(eurRate, 12);
        this.amountEur = kept(quantity.multiply(price, MC).divide(eurRate, MC), 12);
        this.fees = kept(fees, 8);
        this.feesEur = kept(fees.divide(eurRate, MC), 8);
        return this;
    }

    /**
     * Its day, share and figures by its totals: the rate (and the fees in the currency) worked out from them.
     *
     * @param amount    its total in {@code currency}, before fees
     * @param amountEur its total in euro, before fees
     * @param feesEur   its fees in euro
     */
    public ShareTrade byAmounts(Kind kind, LocalDate date, String symbol, BigDecimal quantity, BigDecimal amount, String currency,
                                BigDecimal amountEur, BigDecimal feesEur, Instant now) {
        set(kind, date, symbol, quantity, currency, now);
        this.amount = kept(amount, 12);
        this.amountEur = kept(amountEur, 12);
        this.eurRate = this.currency.equals("EUR") ? BigDecimal.ONE
                : amount.signum() > 0 && amountEur.signum() > 0 ? kept(amount.divide(amountEur, MC), 12) : null;
        this.feesEur = kept(feesEur, 8);
        this.fees = kept(eurRate == null ? feesEur : feesEur.multiply(eurRate, MC), 8);
        return this;
    }

    /** A figure to as many decimals as it's kept. */
    private static BigDecimal kept(BigDecimal value, int decimals) {
        return value.setScale(decimals, RoundingMode.HALF_UP);
    }

    private void set(Kind kind, LocalDate date, String symbol, BigDecimal quantity, String currency, Instant now) {
        String code = currency.trim().toUpperCase(Locale.ROOT);
        // another day or currency: another ECB rate (in euro, one)
        if (code.equals("EUR")) {
            this.ecbRate = BigDecimal.ONE;
            this.ecbRateDate = date;
        } else if (!date.equals(this.date) || !code.equals(this.currency)) {
            this.ecbRate = null;
            this.ecbRateDate = null;
        }
        this.kind = kind;
        this.date = date;
        this.symbol = symbol.trim().toUpperCase(Locale.ROOT);
        this.quantity = kept(quantity, 8);
        this.currency = code;
        this.updatedAt = now;
    }

    /** The ECB's reference rate of its day, as looked up: the rate, and the day it's the ECB's rate of. */
    public ShareTrade setEcbRate(LocalDate rateDate, BigDecimal rate) {
        this.ecbRate = kept(rate, 12);
        this.ecbRateDate = rateDate;
        return this;
    }

    /** What it is and whose: its name, an ETF or shares, the owner. */
    public ShareTrade describe(@Nullable String name, Asset asset, Owner owner) {
        this.name = name == null || name.isBlank() ? null : name.trim();
        this.asset = asset;
        this.owner = owner;
        return this;
    }

    public ShareTrade setSource(@Nullable Source source) {
        this.source = kind == Kind.BUY ? source : null;
        return this;
    }

    public ShareTrade setNote(@Nullable String note) {
        String n = note == null ? null : note.trim();
        this.note = n == null || n.isEmpty() ? null : n;
        return this;
    }

    public ShareTrade setCostEur(@Nullable BigDecimal costEur) {
        this.costEur = kind == Kind.SELL && costEur != null ? kept(costEur, 4) : null;
        return this;
    }

    /** The price a share, in its currency (0 for a split). */
    public BigDecimal price() {
        return quantity.signum() == 0 ? BigDecimal.ZERO : amount.divide(quantity, MC);
    }

    /** Whether it can be counted for tax: shares, an amount in euro to go with the amount (a rate), or a split. */
    public boolean countable() {
        return quantity.signum() > 0 && (kind == Kind.SPLIT || eurRate != null);
    }

    /** A figure as an app shows it: to so many decimals, without trailing zeros. */
    public static BigDecimal shown(BigDecimal value, int decimals) {
        return value.setScale(decimals, RoundingMode.HALF_UP).stripTrailingZeros();
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public Kind getKind() {
        return kind;
    }

    public LocalDate getDate() {
        return date;
    }

    public String getSymbol() {
        return symbol;
    }

    public @Nullable String getName() {
        return name;
    }

    public Asset getAsset() {
        return asset;
    }

    public Owner getOwner() {
        return owner;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public @Nullable BigDecimal getEurRate() {
        return eurRate;
    }

    public @Nullable BigDecimal getEcbRate() {
        return ecbRate;
    }

    public @Nullable LocalDate getEcbRateDate() {
        return ecbRateDate;
    }

    public BigDecimal getAmountEur() {
        return amountEur;
    }

    public BigDecimal getFees() {
        return fees;
    }

    public BigDecimal getFeesEur() {
        return feesEur;
    }

    public @Nullable BigDecimal getCostEur() {
        return costEur;
    }

    public @Nullable Source getSource() {
        return source;
    }

    public @Nullable String getNote() {
        return note;
    }

    public App getEnteredIn() {
        return enteredIn;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

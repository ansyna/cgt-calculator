package com.cgtcalculator.platform.ledger;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Predicate;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.cgtcalculator.platform.web.ApiExceptionHandler.NotFoundException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

/** The user's record of share trades, which the CGT calculator works from. Users only ever see and change their own trades. */
@Service
@Transactional
public class ShareTradeService {

    /** More than anyone trades; keeps one account from filling the database. */
    public static final int MAX_TRADES = 10_000;

    /** Days apart two trades alike are taken for perhaps the same one: a trade's day and its settlement's (two working days). */
    public static final int NEAR_DAYS = 3;

    private final ShareTradeRepository trades;
    private final ShareTradeEcbRates ecbRates;

    ShareTradeService(ShareTradeRepository trades, ShareTradeEcbRates ecbRates) {
        this.trades = trades;
        this.ecbRates = ecbRates;
    }

    /** The user's trades, by day (and the order they were recorded in). */
    @Transactional(readOnly = true)
    public List<ShareTrade> list(Long userId) {
        return trades.findByUserIdOrderByDateAscIdAsc(userId);
    }

    /** A trade of the user's. */
    @Transactional(readOnly = true)
    public ShareTrade get(Long userId, Long id) {
        return trades.findByIdAndUserId(id, userId).orElseThrow(() -> new NotFoundException("No such trade."));
    }

    @Transactional(readOnly = true)
    public Optional<ShareTrade> find(Long userId, Long id) {
        return trades.findByIdAndUserId(id, userId);
    }

    /** Records a new trade, or a change to one (a trade of the user's: see {@link #get}). */
    public ShareTrade save(ShareTrade trade) {
        if (trade.getId() == null && trades.countByUserId(trade.getUserId()) >= MAX_TRADES) {
            throw new ValidationException("symbol", "You have the most trades allowed (" + MAX_TRADES + "): delete some first.");
        }
        // the ECB's rate of its day beside the rate it's entered with; looked up later when the ECB can't be reached now
        ecbRates.lookUp(trade);
        if (trade.getEcbRate() == null) ecbRates.soon();
        return trades.save(trade);
    }

    /**
     * Records trades at once, after deleting those the user's trades {@code replaced} picks (none to add them): all or
     * none.
     */
    public List<ShareTrade> saveAll(Long userId, List<ShareTrade> added, Predicate<ShareTrade> replaced) {
        List<ShareTrade> gone = list(userId).stream().filter(replaced).toList();
        if (trades.countByUserId(userId) - gone.size() + added.size() > MAX_TRADES) {
            throw new ValidationException("trades", "That would be more than the " + MAX_TRADES + " trades allowed.");
        }
        trades.deleteAll(gone);
        trades.flush();
        List<ShareTrade> saved = trades.saveAll(added);
        // many at once: their ECB rates looked up together, once they're saved
        if (saved.stream().anyMatch(t -> t.getEcbRate() == null)) ecbRates.soon();
        return saved;
    }

    public void delete(ShareTrade trade) {
        trades.delete(trade);
    }

    /** Deletes the user's trades {@code which} picks from one day to another (both included); how many there were. */
    public int deleteBetween(Long userId, LocalDate from, LocalDate to, Predicate<ShareTrade> which) {
        List<ShareTrade> gone = list(userId).stream().filter(t -> !t.getDate().isBefore(from) && !t.getDate().isAfter(to)).filter(which).toList();
        trades.deleteAll(gone);
        return gone.size();
    }

    /** The user's trades of shares acquired a way (bought, vested, through an ESPP). */
    @Transactional(readOnly = true)
    public List<ShareTrade> acquisitions(Long userId, ShareTrade.Source source) {
        return list(userId).stream().filter(t -> t.getKind() == ShareTrade.Kind.BUY && t.getSource() == source).toList();
    }

    /**
     * Records a purchase another app knows of (an ESPP purchase, say), unless one alike is there that day already;
     * whether it was added.
     */
    public boolean recordUnlessThere(ShareTrade purchase) {
        boolean there = list(purchase.getUserId()).stream().anyMatch(t -> t.getDate().equals(purchase.getDate()) && alike(t, purchase));
        if (!there) save(purchase);
        return !there;
    }

    /**
     * Pairs of the user's trades perhaps the same one recorded twice: alike, entered in different apps (or at different
     * times) a day to {@link #NEAR_DAYS} apart, as a trade's day and its settlement's would be. Each later trade is paired
     * with the first such before it.
     */
    @Transactional(readOnly = true)
    public List<ShareTrade[]> possibleDuplicates(Long userId) {
        List<ShareTrade> all = list(userId).stream().filter(t -> t.getKind() != ShareTrade.Kind.SPLIT).toList();
        List<ShareTrade[]> pairs = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            ShareTrade later = all.get(i);
            for (int j = 0; j < i; j++) {
                ShareTrade earlier = all.get(j);
                long apart = later.getDate().toEpochDay() - earlier.getDate().toEpochDay();
                if (apart > 0 && apart <= NEAR_DAYS && earlier.getEnteredIn() != later.getEnteredIn() && alike(earlier, later)) {
                    pairs.add(new ShareTrade[] {earlier, later});
                    break;
                }
            }
        }
        return pairs;
    }

    /**
     * A ticker as trades are compared: upper case, without an exchange prefix ("NASDAQ:"), a class's "." and "-" alike
     * ("BRK.B" and "BRK-B" are the same share).
     */
    public static String symbolKey(String symbol) {
        String s = symbol.trim().toUpperCase(Locale.ROOT);
        int colon = s.indexOf(':');
        if (colon >= 0) s = s.substring(colon + 1);
        return s.replace('.', '-');
    }

    /** The same kind of trade in the same share, of the same number of shares to within a broker's rounding (0.05%). */
    public static boolean alike(ShareTrade a, ShareTrade b) {
        if (a.getKind() != b.getKind() || !symbolKey(a.getSymbol()).equals(symbolKey(b.getSymbol()))) return false;
        BigDecimal tolerance = a.getQuantity().max(b.getQuantity()).multiply(new BigDecimal("0.0005")).max(new BigDecimal("0.000001"));
        return a.getQuantity().subtract(b.getQuantity()).abs().compareTo(tolerance) <= 0;
    }
}

package billingo.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import billingo.app.R
import billingo.app.data.HomeData
import billingo.app.data.Item
import billingo.app.data.Me
import billingo.app.data.Party
import billingo.app.data.SaleRow
import billingo.app.ui.parts.AmountWithWord
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Banner
import billingo.app.ui.parts.BannerKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Due
import billingo.app.ui.parts.EmptyState
import billingo.app.ui.parts.FootBar
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.Header
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SummaryCard
import billingo.app.ui.parts.T
import billingo.app.ui.parts.Tabs
import billingo.app.ui.theme.Colours
import java.math.BigDecimal

/** What Home shows from the server's lists, worked out here so it can be tested. */
object HomeMaths {
    /** You'll Get / You'll Give: the sum of positive and of negative balances, and how many parties. */
    data class Totals(val get: BigDecimal, val getCount: Int, val give: BigDecimal, val giveCount: Int)

    fun totals(parties: List<Party>): Totals {
        var get = BigDecimal.ZERO; var give = BigDecimal.ZERO; var gc = 0; var vc = 0
        for (p in parties) {
            val b = BigDecimal(p.balance)
            if (b.signum() > 0) { get += b; gc++ } else if (b.signum() < 0) { give += b.negate(); vc++ }
        }
        return Totals(get, gc, give, vc)
    }

    /** Money to get first (largest first), then money to give, then settled; names A–Z within. */
    fun ordered(parties: List<Party>): List<Party> = parties.sortedWith(
        compareBy<Party> { val b = BigDecimal(it.balance); if (b.signum() > 0) 0 else if (b.signum() < 0) 1 else 2 }
            .thenByDescending { BigDecimal(it.balance).abs() }
            .thenBy { it.name.lowercase() },
    )

    /** The newest bills first. */
    fun latest(sales: List<SaleRow>): List<SaleRow> = sales.sortedWith(compareByDescending<SaleRow> { it.date }.thenByDescending { it.number })

    /** A bill's badge: Cancelled, Paid, Overdue N days, Part Paid or Credit (the design's words). */
    sealed interface Status {
        data object Cancelled : Status
        data object Paid : Status
        data class Overdue(val days: Int) : Status
        data object PartPaid : Status
        data object Credit : Status
    }

    fun status(s: SaleRow, today: String): Status {
        if (s.cancelled) return Status.Cancelled
        val bal = BigDecimal(s.balance)
        if (bal.signum() <= 0) return Status.Paid
        val due = s.dueDate
        if (due != null) { val late = Format.daysBetween(due, today); if (late > 0) return Status.Overdue(late) }
        return if (bal < BigDecimal(s.total)) Status.PartPaid else Status.Credit
    }
}

/**
 * Home (design 7.4a, approved): the shop on top, You'll Get / You'll Give, and the Parties, Bills
 * and Items tabs with real numbers from the server; Take Payment, Create New (+) and New Bill at
 * the bottom. Pull down to refresh. Screens that open from here come in later steps ([onLater]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    me: Me,
    data: HomeData,
    loading: Boolean,
    offline: Boolean,
    waking: Boolean,
    onMenu: () -> Unit,
    onCreate: () -> Unit,
    onRefresh: () -> Unit,
    onLater: () -> Unit,
    onParties: (bal: String) -> Unit = { onLater() },
    onParty: (Party) -> Unit = { onLater() },
    onItem: (Item) -> Unit = { onLater() },
    onNewBill: () -> Unit = onLater,
) {
    val hi = LocalConfiguration.current.locales[0].language == "hi"
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val today = Format.todayIso()
    val pull = rememberPullToRefreshState()

    Column(Modifier.fillMaxSize().background(Colours.Page)) {
        Box(Modifier.background(Colours.Card).statusBarsPadding()) {
            Header(
                me.business?.name ?: "",
                stringResource(R.string.today_line, Format.date(today, hi)),
                left = { IconBtn(Icons.Menu, stringResource(R.string.menu), onMenu) },
            ) { IconBtn(Icons.Search, stringResource(R.string.search), onLater) }
        }
        PullToRefreshBox(
            isRefreshing = loading,
            onRefresh = onRefresh,
            state = pull,
            modifier = Modifier.weight(1f),
            indicator = {
                PullToRefreshDefaults.Indicator(state = pull, isRefreshing = loading, modifier = Modifier.align(Alignment.TopCenter), containerColor = Colours.Card, color = Colours.Blue)
            },
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (offline) item { Banner(BannerKind.Offline, stringResource(R.string.offline_title), stringResource(R.string.offline_text)) }
                else if (waking) item { Banner(BannerKind.Waking, stringResource(R.string.waking_title), stringResource(R.string.waking_text)) }
                item { Summary(data.parties, onParties) }
                item { Tabs(listOf(stringResource(R.string.tab_parties), stringResource(R.string.tab_bills), stringResource(R.string.tab_items)), tab) { tab = it } }
                when (tab) {
                    0 -> rows(data.parties, loading) { list ->
                        if (list.isEmpty()) item { EmptyState(Icons.User, stringResource(R.string.no_parties), stringResource(R.string.no_parties_sub), stringResource(R.string.add_party), onLater) }
                        items(HomeMaths.ordered(list).take(50), key = { it.id }) { PartyRow(it) { onParty(it) } }
                    }
                    1 -> rows(data.sales, loading) { list ->
                        if (list.isEmpty()) item { EmptyState(Icons.Bill, stringResource(R.string.no_bills), stringResource(R.string.no_bills_sub), stringResource(R.string.new_bill), onNewBill) }
                        items(HomeMaths.latest(list).take(50), key = { it.id }) { BillRow(it, today, hi, onLater) }
                    }
                    else -> rows(data.items, loading) { list ->
                        if (list.isEmpty()) item { EmptyState(Icons.Box, stringResource(R.string.no_items), stringResource(R.string.no_items_sub), stringResource(R.string.add_item), onLater) }
                        items(list.take(50), key = { it.id }) { ItemRow(it) { onItem(it) } }
                    }
                }
            }
        }
        FootBar {
            Btn(stringResource(R.string.take_payment), onLater, Modifier.weight(1f), Kind.Soft, Icons.Rupee)
            IconBtn(Icons.Plus, stringResource(R.string.create_new), onCreate, Kind.Blue)
            Btn(stringResource(R.string.new_bill), onNewBill, Modifier.weight(1f), Kind.Blue)
        }
    }
}

/** A list that may be loading (grey bars), refused (no permission) or ready. */
private fun <T> androidx.compose.foundation.lazy.LazyListScope.rows(list: List<T>?, loading: Boolean, ready: androidx.compose.foundation.lazy.LazyListScope.(List<T>) -> Unit) {
    when {
        list != null -> ready(list)
        loading -> item { Loading() }
        else -> item { T(stringResource(R.string.not_allowed), colour = Colours.Text3, modifier = Modifier.padding(8.dp)) }
    }
}

@Composable
private fun Summary(parties: List<Party>?, onTap: (String) -> Unit) {
    val t = HomeMaths.totals(parties ?: emptyList())
    @Composable
    fun count(n: Int) = if (n == 1) stringResource(R.string.parties_n_1) else stringResource(R.string.parties_n, n)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SummaryCard(stringResource(R.string.you_get), t.get.toPlainString(), count(t.getCount), toGet = true, modifier = Modifier.weight(1f).clickable(role = Role.Button) { onTap("rec") })
        SummaryCard(stringResource(R.string.you_give), t.give.toPlainString(), count(t.giveCount), toGet = false, modifier = Modifier.weight(1f).clickable(role = Role.Button) { onTap("pay") })
    }
}

@Composable
private fun PartyRow(p: Party, onTap: () -> Unit) {
    val b = BigDecimal(p.balance)
    val sub = stringResource(if (p.kind == "supplier") R.string.supplier else R.string.customer)
    ListRow(p.name, sub, onTap) {
        when {
            b.signum() > 0 -> AmountWithWord(Format.inr(b), stringResource(R.string.to_get), Due.ToGet)
            b.signum() < 0 -> AmountWithWord(Format.inr(b.negate()), stringResource(R.string.to_give), Due.ToGive)
            else -> AmountWithWord("0", stringResource(R.string.settled), Due.Settled)
        }
    }
}

@Composable
private fun BillRow(s: SaleRow, today: String, hi: Boolean, onTap: () -> Unit) {
    // a transaction row: the name, then "INV-0107 | 14 Nov 2026" under it (owner, 15 Nov 2026)
    ListRow(s.partyName, "${s.number} | ${Format.date(s.date, hi)}", onTap) {
        AmountWithWord(Format.inr(s.total), "", if (s.cancelled) Due.Settled else Due.Plain)
        when (val st = HomeMaths.status(s, today)) {
            HomeMaths.Status.Cancelled -> Badge(stringResource(R.string.b_cancelled), BadgeKind.Grey, struck = true)
            HomeMaths.Status.Paid -> Badge(stringResource(R.string.b_paid), BadgeKind.Paid, icon = Icons.Check)
            is HomeMaths.Status.Overdue -> Badge(if (st.days == 1) stringResource(R.string.b_overdue_1) else stringResource(R.string.b_overdue, st.days), BadgeKind.Due)
            HomeMaths.Status.PartPaid -> Badge(stringResource(R.string.b_part_paid), BadgeKind.Credit)
            HomeMaths.Status.Credit -> Badge(stringResource(R.string.b_credit), BadgeKind.Credit)
        }
    }
}

/** "PCS" → "Pcs", "ROLL" → "Roll": every word starts with a capital (owner, 15 Nov 2026). */
fun unitWord(u: String): String = u.trim().split(' ').joinToString(" ") { w -> w.lowercase().replaceFirstChar { it.uppercase() } }

@Composable
private fun ItemRow(i: Item, onTap: () -> Unit) {
    val buy = Format.inr(i.purchase, paise = false)
    val sell = Format.inr(i.sale, paise = false)
    val unit = unitWord(i.unit)
    val sub = if (unit.isBlank()) stringResource(R.string.item_prices_nounit, buy, sell) else stringResource(R.string.item_prices, buy, sell, unit)
    ListRow(i.name, sub, onTap) {
        if (i.kind == "service" || i.stock == null) AmountWithWord(stringResource(R.string.service), "", Due.Settled)
        else AmountWithWord("${Format.qty(i.stock)} $unit".trim(), "", Due.Plain)
        when (i.level) {
            "low" -> Badge(stringResource(R.string.b_low), BadgeKind.Credit)
            "out" -> Badge(stringResource(R.string.b_out), BadgeKind.Due)
        }
    }
}

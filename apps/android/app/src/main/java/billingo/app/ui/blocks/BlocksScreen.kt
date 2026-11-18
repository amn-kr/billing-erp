package billingo.app.ui.blocks

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.ui.parts.AmountWithWord
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Banner
import billingo.app.ui.parts.BannerKind
import billingo.app.ui.parts.BottomBar
import billingo.app.ui.parts.BoxCard
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.ButtonRow
import billingo.app.ui.parts.CheckRow
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ConfirmBox
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Due
import billingo.app.ui.parts.EmptyState
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.IconTap
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SectionLabel
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.SummaryCard
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.Tabs
import billingo.app.ui.parts.TileGrid
import billingo.app.ui.parts.Toast
import billingo.app.ui.parts.TopBar
import billingo.app.ui.theme.Colours

/**
 * The Building Blocks page: every block of design step 7.2 with the design's own sample words, in
 * English and Hindi, so the owner can check them on a real phone. Test builds open it from Sign In
 * (tap the version line five times). The samples are made up (Sharma Electricals & Hardware).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BlocksScreen(onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val hi = LocalConfiguration.current.locales[0].language == "hi"
    fun t(en: String, hindi: String) = if (hi) hindi else en

    var tab by remember { mutableIntStateOf(0) }
    var name by remember { mutableStateOf("Raju Electrician") }
    var phone by remember { mutableStateOf("98765 43210") }
    var amount by remember { mutableStateOf("4,000.00") }
    var gstin by remember { mutableStateOf("09AAJPM7745Q1Z") }
    var date by remember { mutableStateOf(t("15 Nov 2026", "15 नव॰ 2026")) }
    var search by remember { mutableStateOf("") }
    var incl by remember { mutableStateOf(true) }
    var full by remember { mutableStateOf(true) }
    var sheet by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(true) }
    val nothing = {}

    Box(Modifier.fillMaxSize().background(Colours.Page)) {
        Column(
            Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row {
                IconBtn(Icons.Back, t("Back", "पीछे"), onBack)
                T(t("Building Blocks", "बुनियादी टुकड़े"), Modifier.padding(top = 10.dp), size = 17.sp, weight = FontWeight.Bold)
            }

            SectionLabel(t("Top Bar", "ऊपर की पट्टी"))
            TopBar("Sharma Electricals & Hardware Pvt Ltd", t("Today · 15 Nov 2026", "आज · 15 नव॰ 2026"), nothing, nothing, t("Menu", "मेन्यू"), t("Notifications", "सूचनाएँ"))

            SectionLabel(t("Summary Cards", "सारांश कार्ड"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SummaryCard(t("You'll Get", "आपको मिलेगा"), "25872.40", t("3 Parties", "3 पार्टी"), toGet = true, modifier = Modifier.weight(1f))
                SummaryCard(t("You'll Give", "आपको देना है"), "160119", t("1 Party", "1 पार्टी"), toGet = false, modifier = Modifier.weight(1f))
            }

            SectionLabel(t("Tabs", "टैब"))
            Tabs(listOf(t("Parties", "पार्टी"), t("Bills", "बिल"), t("Items", "आइटम")), tab) { tab = it }

            SectionLabel(t("List Rows", "सूची की पंक्तियाँ"))
            ListRow("Mehta Electricals", t("Last: 1 Oct 2026", "आख़िरी: 1 अक्टू॰ 2026"), nothing) { AmountWithWord("21,749.40", t("↓ To Get", "↓ मिलेगा"), Due.ToGet) }
            ListRow("Shree Ganesh Electrical & Sanitary Traders, Kidwai Nagar Kanpur", t("Long Name: One Line, Then …", "लंबा नाम: एक ही लाइन, फिर …"), nothing) { AmountWithWord("1,60,119", t("↑ To Give", "↑ देना है"), Due.ToGive) }
            ListRow("Walk-in Ramesh", t("Customer", "ग्राहक"), nothing) { AmountWithWord("0", t("Settled", "बराबर"), Due.Settled) }
            ListRow("Mehta Electricals", t("INV-0107 | 25 Sep 2026", "INV-0107 | 25 सित॰ 2026"), nothing) {
                AmountWithWord("2,123.00", "", Due.Plain)
                Badge(t("Credit", "उधार"), BadgeKind.Credit)
            }
            ListRow("LED Bulb 9W Cool Day Light (Philips)", t("Purchase Price ₹70 · Sale Price ₹85 Per Pc", "ख़रीद दाम ₹70 · बिक्री दाम ₹85 प्रति पीस"), nothing) {
                AmountWithWord(t("12 Pcs", "12 पीस"), "", Due.Plain)
                Badge(t("Low Stock", "स्टॉक कम"), BadgeKind.Credit)
            }

            SectionLabel(t("Badges", "Badge"))
            BoxCard {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Badge(t("Paid", "भुगतान हुआ"), BadgeKind.Paid, icon = Icons.Check)
                    Badge(t("Overdue 12 Days", "बकाया 12 दिन"), BadgeKind.Due)
                    Badge(t("Credit ₹4,000", "उधार ₹4,000"), BadgeKind.Credit)
                    Badge(t("Part Paid", "आंशिक भुगतान"), BadgeKind.Credit)
                    Badge(t("Low Stock: 3", "स्टॉक कम: 3"), BadgeKind.Credit)
                    Badge("Quotation", BadgeKind.Info)
                    Badge(t("Draft", "ड्राफ़्ट"), BadgeKind.Grey)
                    Badge(t("Cancelled", "रद्द"), BadgeKind.Grey, struck = true)
                }
            }

            SectionLabel(t("Buttons", "बटन"))
            BoxCard {
                ButtonRow {
                    Btn(t("New Bill", "नया बिल"), nothing, Modifier.weight(1f), Kind.Blue, Icons.Plus)
                    Btn(t("Save", "सेव करें"), nothing, Modifier.weight(1f), Kind.Green, Icons.Check)
                }
                ButtonRow {
                    Btn(t("Add Item", "आइटम जोड़ें"), nothing, Modifier.weight(1f), Kind.Soft, Icons.Plus)
                    Btn(t("Scan", "स्कैन"), nothing, Modifier.weight(1f), Kind.Soft, Icons.Scan)
                }
                ButtonRow {
                    Btn(t("Filter", "छाँटें"), nothing, Modifier.weight(1f), Kind.Line, Icons.Filter)
                    Btn(t("Delete", "हटाएँ"), nothing, Modifier.weight(1f), Kind.Delete, Icons.Trash)
                }
                ButtonRow {
                    Btn(t("Saving…", "सेव हो रहा है…"), { busy = !busy }, Modifier.weight(1f), Kind.Green, busy = busy)
                    IconBtn(Icons.Share, t("Share", "भेजें"), nothing, Kind.Soft)
                    IconBtn(Icons.Trash, t("Delete", "हटाएँ"), nothing, Kind.Delete)
                }
                T(
                    t(
                        "Blue = Start · Green = Finish · Light Blue = Second Actions · White = Small Actions · Light Red = Delete",
                        "नीला = नया काम शुरू · हरा = पूरा करो · हल्का नीला = दूसरे काम · सफ़ेद = छोटे काम · हल्का लाल = हटाना",
                    ),
                    size = 12.sp,
                    colour = Colours.Text3,
                )
            }

            SectionLabel(t("Form Fields", "भरने वाले खाने"))
            BoxCard {
                Field(t("Party Name", "पार्टी का नाम"), name, { name = it }, trailing = { IconTap(Icons.Book, t("Pick From Contacts", "संपर्क से चुनें"), nothing, tint = Colours.Blue) })
                Field(t("Mobile", "मोबाइल"), phone, { phone = it }, prefix = "+91", keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone))
                Field(t("Amount", "रक़म"), amount, { amount = it }, prefix = "₹", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                Field("GSTIN", gstin, { gstin = it }, error = if (gstin.length == 15) null else t("A GSTIN has 15 characters. One is missing.", "GSTIN 15 अक्षर का होता है। एक अक्षर कम है।"))
                Field(t("Date", "तारीख़"), date, { date = it }, leading = Icons.Calendar)
                ChoiceField(t("Payment", "भुगतान"), "UPI", nothing)
                Field(null, search, { search = it }, leading = Icons.Search, placeholder = t("Search Party, Bill, Item", "पार्टी, बिल, आइटम खोजें"))
                SwitchRow(t("Prices Include GST", "GST के साथ दाम"), incl) { incl = it }
                CheckRow(t("Full Amount Received", "पूरी रक़म मिल गई"), full) { full = it }
            }

            SectionLabel(t("Bottom Action Bar", "नीचे की बटन-पट्टी"))
            BottomBar {
                Btn(t("Take Payment", "भुगतान लें"), nothing, Modifier.weight(1f), Kind.Soft, Icons.Rupee)
                Btn(t("New Bill", "नया बिल"), nothing, Modifier.weight(1f), Kind.Blue, Icons.Plus)
            }
            BottomBar {
                IconBtn(Icons.Trash, t("Delete", "हटाएँ"), nothing, Kind.Delete)
                Btn(t("Share", "भेजें"), nothing, Modifier.weight(1f), Kind.Soft, Icons.Share)
                Btn(t("Save", "सेव करें"), nothing, Modifier.weight(1f), Kind.Green, Icons.Check)
            }

            SectionLabel(t("Bottom Sheet", "नीचे से खुलने वाली शीट"))
            Btn(t("Create New", "नया बनाएँ"), { sheet = true }, Modifier.fillMaxWidth(), Kind.Soft, Icons.Plus)

            SectionLabel(t("Confirm Box", "पूछने वाला डिब्बा"))
            Btn(t("Cancel Bill", "रद्द करें"), { confirm = true }, Modifier.fillMaxWidth(), Kind.Delete, Icons.Close)

            SectionLabel(t("Special States", "ख़ास हालात"))
            Banner(BannerKind.Offline, t("No Internet", "इंटरनेट नहीं है"), t("Your bill is safe on this phone. It goes as soon as the internet is back.", "आपका बिल फ़ोन में सुरक्षित है। इंटरनेट आते ही भेज देंगे।"))
            Banner(BannerKind.Waking, t("Server Is Waking Up…", "सर्वर चालू हो रहा है…"), t("This can take up to a minute.", "इसमें एक मिनट तक लग सकता है।"))
            Toast(t("Bill INV-0110 Saved", "बिल INV-0110 सेव हो गया"))
            Loading()
            EmptyState(Icons.Box, t("No Items Yet", "अभी कोई आइटम नहीं"), t("Add your first item, or scan its barcode.", "पहला आइटम जोड़ें, या barcode स्कैन करें।"), t("Add Item", "आइटम जोड़ें"), nothing)
        }

        if (sheet) Dim({ sheet = false }) {
            Sheet(t("Create New", "नया बनाएँ")) {
                TileGrid(
                    listOf(
                        Icons.Bill to t("Sale Bill", "बिक्री बिल"),
                        Icons.Rupee to t("Payment In", "भुगतान लें"),
                        Icons.Bill to "Quotation",
                        Icons.Cart to t("Purchase Bill", "ख़रीद बिल"),
                        Icons.Wallet to t("Expense", "ख़र्चा"),
                        Icons.User to t("New Party", "नई पार्टी"),
                    ),
                ) { sheet = false }
            }
        }
        if (confirm) Dim({ confirm = false }) {
            ConfirmBox(
                t("Cancel Bill INV-0107?", "बिल INV-0107 रद्द करें?"),
                t("The bill shows as cancelled and leaves the totals. Stock and the party's balance go back.", "बिल रद्द दिखेगा और गिनती से हट जाएगा। स्टॉक और पार्टी का बैलेंस वापस हो जाएगा।"),
                t("Keep", "रहने दें"),
                t("Cancel Bill", "रद्द करें"),
                { confirm = false },
                { confirm = false },
            )
        }
    }
}

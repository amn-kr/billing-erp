package billingo.app

import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.MemoryStore
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** The phone's sign-in calls (step 8.2c), against a pretend server. */
class ApiTest {
    private lateinit var server: MockWebServer
    private lateinit var store: MemoryStore
    private lateinit var api: Api

    private fun json(code: Int, body: String) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private val tokens = """{"accessToken":"A1","expiresIn":900,"refreshToken":"R1","refreshExpires":"2026-12-18T10:00:00.000Z"}"""
    private val me = """{"user":{"id":"u1","name":"Aman","email":"owner@example.com","mustChangePassword":false},"business":{"id":"b1","name":"Sharma Electricals & Hardware","gstEnabled":true,"plan":"trial","features":[]},"role":"owner","permissions":[],"memberships":[{"businessId":"b1","businessName":"Sharma Electricals & Hardware","role":"owner"},{"businessId":"b2","businessName":"Sharma Traders","role":"owner"}],"invites":[]}"""

    @Before fun start() {
        server = MockWebServer().apply { start() }
        store = MemoryStore()
        api = Api(server.url("/").toString(), store)
    }

    @After fun stop() = server.shutdown()

    @Test fun `signing in says it is the phone and keeps the token in the safe store`() = runTest {
        server.enqueue(json(200, tokens))
        api.login("owner@example.com", "pass word 1")
        val r = server.takeRequest()
        assertEquals("/api/auth/login", r.path)
        assertEquals("phone", r.getHeader("x-app-client"))
        assertTrue(r.body.readUtf8().contains("\"email\":\"owner@example.com\""))
        assertEquals("A1", api.access)
        assertEquals("R1", store.refreshToken)
    }

    @Test fun `the answer about me is read, unknown parts are skipped`() = runTest {
        server.enqueue(json(200, tokens)); server.enqueue(json(200, me))
        api.login("owner@example.com", "x")
        val m = api.me()
        assertEquals("Sharma Electricals & Hardware", m.business?.name)
        assertEquals(2, m.memberships.size)
        assertEquals("Bearer A1", server.let { it.takeRequest(); it.takeRequest() }.getHeader("Authorization"))
    }

    @Test fun `an expired access token is renewed once, then the call is sent again`() = runTest {
        store.refreshToken = "R0"
        server.enqueue(json(401, """{"message":"Please sign in."}"""))
        server.enqueue(json(200, tokens))
        server.enqueue(json(200, me))
        assertEquals("u1", api.me().user.id)
        server.takeRequest()
        val renew = server.takeRequest()
        assertEquals("/api/auth/refresh", renew.path)
        assertEquals("R0", renew.getHeader("x-refresh-token"))
        assertEquals("Bearer A1", server.takeRequest().getHeader("Authorization"))
        assertEquals("R1", store.refreshToken)
    }

    @Test fun `a refused token signs the phone out`() = runTest {
        store.refreshToken = "old"
        store.fingerprint = true
        server.enqueue(json(401, """{"message":"Please sign in."}"""))
        assertFalse(api.renew())
        assertNull(store.refreshToken)
        assertFalse(store.fingerprint)
    }

    @Test fun `the server's words come through, and no internet is status 0`() = runTest {
        server.enqueue(json(401, """{"statusCode":401,"message":"Wrong email or password."}"""))
        try { api.login("a@example.com", "x"); fail() } catch (e: ApiError) { assertEquals("Wrong email or password.", e.message); assertEquals(401, e.status) }
        server.enqueue(json(400, """{"message":["Enter your email."]}"""))
        try { api.login("", "x"); fail() } catch (e: ApiError) { assertEquals("Enter your email.", e.message) }
        server.enqueue(json(429, """{"message":"ThrottlerException"}"""))
        try { api.login("a@example.com", "x"); fail() } catch (e: ApiError) { assertEquals("Too many tries. Wait a minute and try again.", e.message) }
        server.shutdown()
        try { api.login("a@example.com", "x"); fail() } catch (e: ApiError) { assertEquals(0, e.status) }
    }

    @Test fun `signing out works even without internet`() = runTest {
        store.refreshToken = "R1"
        server.shutdown()
        api.logout()
        assertNull(store.refreshToken)
        assertNull(api.access)
    }

    @Test fun `switching company keeps the new tokens`() = runTest {
        server.enqueue(json(201, """{"accessToken":"A2","expiresIn":900,"refreshToken":"R2","refreshExpires":"2026-12-18T10:00:00.000Z"}"""))
        api.switchCompany("b2")
        val r = server.takeRequest()
        assertEquals("/api/businesses/switch", r.path)
        assertEquals("""{"businessId":"b2"}""", r.body.readUtf8())
        assertEquals("R2", store.refreshToken)
    }

    @Test fun `a slow answer counts as "Server Is Waking Up" until it comes`() = kotlinx.coroutines.runBlocking {
        server.enqueue(json(200, """{"latest":null,"notes":""}""").setBodyDelay(Api.SLOW_MS + 1500, java.util.concurrent.TimeUnit.MILLISECONDS))
        var seen = 0
        val watch = launch { while (true) { seen = maxOf(seen, api.slow.value); kotlinx.coroutines.delay(100) } }
        api.appVersion()
        watch.cancel()
        assertEquals(1, seen)
        assertEquals(0, api.slow.value)
    }

    @Test fun `a quick answer never shows it`() = runTest {
        server.enqueue(json(200, """{"latest":null,"notes":""}"""))
        api.appVersion()
        assertEquals(0, api.slow.value)
    }
}

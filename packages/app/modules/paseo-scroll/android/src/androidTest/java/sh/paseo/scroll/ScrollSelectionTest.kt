// RN 0.86 requires this internal dispatcher contract even without a running JS instance.
@file:Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER")

package sh.paseo.scroll

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.ViewGroup
import androidx.appcompat.view.menu.MenuBuilder
import com.swmansion.enriched.markdown.parser.MarkdownASTNode
import com.swmansion.enriched.markdown.parser.MarkdownASTNode.NodeType
import com.swmansion.enriched.markdown.segments.*
import com.swmansion.enriched.markdown.styles.StyleConfig
import com.swmansion.enriched.markdown.accessibility.AccessibilityLabels
import com.swmansion.enriched.markdown.utils.text.view.SelectionMenuConfig
import android.text.Selection
import android.text.Spannable
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.EventDispatcherProvider
import com.facebook.react.uimanager.events.BlackHoleEventDispatcher
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager
import com.facebook.soloader.SoLoader
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScrollSelectionTest {
  @Test fun focusingSelectableTextKeepsInvertedViewportStill() = withScroll(inverted = true) { scroll, text ->
    val before = scroll.scrollY
    assertTrue(text.requestFocus())
    assertSame(text, scroll.findFocus())
    assertEquals("Text focus must not move the inverted viewport", before, scroll.scrollY)
    assertTrue(text.isTextSelectable)
  }

  @Test fun selectingTextKeepsInvertedViewportStill() = withScroll(inverted = true) { scroll, text ->
    val before = scroll.scrollY
    Selection.setSelection(text.text as Spannable, 0, 8)
    text.requestRectangleOnScreen(Rect(0, 0, 80, 40), true)
    assertEquals("Selection visibility requests must not move the inverted viewport", before, scroll.scrollY)
    assertEquals("Selectab", text.text.subSequence(text.selectionStart, text.selectionEnd).toString())
  }

  @Test fun explicitScrollCommandsStillMoveInvertedViewport() = withScroll(inverted = true) { scroll, _ ->
    scroll.scrollTo(0, 600)
    assertEquals(600, scroll.scrollY)
  }

  @Test fun ordinaryScrollViewsStillRevealSelectedText() = withScroll(inverted = false) { scroll, text ->
    val before = scroll.scrollY
    text.requestRectangleOnScreen(Rect(0, 0, 80, 40), true)
    assertNotEquals(before, scroll.scrollY)
  }

  @Test fun verticalScaleStillKeepsFocusAndSelectionInPlace() = withScroll(inverted = true, transform = "scaleY") { scroll, text ->
    val before = scroll.scrollY
    assertTrue(text.requestFocus())
    text.requestRectangleOnScreen(Rect(0, 0, 80, 40), true)
    assertEquals(before, scroll.scrollY)
  }

  @Test fun horizontalScaleStillRevealsSelectedText() = withScroll(inverted = true, transform = "scaleX") { scroll, text ->
    val before = scroll.scrollY
    text.requestRectangleOnScreen(Rect(0, 0, 80, 40), true)
    assertNotEquals(before, scroll.scrollY)
  }

  @Test fun tableCellCopiesOnlySelectedFilename() = withTable { _, cells, clipboard ->
    val cell = cells[2]
    assertTrue("Table cells must support native selection", cell.isTextSelectable)
    val filename = "24709-fa026c250602.epub"
    Selection.setSelection(cell.text as Spannable, 0, filename.length)
    assertTrue(cell.onTextContextMenuItem(android.R.id.copy))
    assertEquals(filename, clipboard.primaryClip!!.getItemAt(0).text.toString())
  }

  @Test fun tableSelectionCanCopyWholeTableWithoutBlockMenu() = withTable { table, cells, clipboard ->
    assertFalse(table.dynamicProps.enableBlockContextMenu)
    val cell = cells[2]
    val menu = MenuBuilder(cell.context)
    val mode = TestActionMode(menu)
    val callback = cell.customSelectionActionModeCallback!!
    assertTrue(callback.onCreateActionMode(mode, menu))
    val copyTable = (0 until menu.size()).map(menu::getItem).single { it.title == "Copy table" }
    assertTrue(callback.onActionItemClicked(mode, copyTable))
    val copied = clipboard.primaryClip!!.getItemAt(0)
    assertEquals("File\tChapters\n24709-fa026c250602.epub (whole book)\t149", copied.text.toString())
    assertTrue(copied.htmlText!!.contains("<table"))
    assertTrue(mode.finished)
  }

  @Test fun tableSelectionCanCopyWholeTableAsMarkdown() = withTable { _, cells, clipboard ->
    val cell = cells[2]
    val menu = MenuBuilder(cell.context)
    val mode = TestActionMode(menu)
    val callback = cell.customSelectionActionModeCallback!!
    callback.onCreateActionMode(mode, menu)
    val item = (0 until menu.size()).map(menu::getItem).single { it.title == "Copy table as Markdown" }
    assertTrue(callback.onActionItemClicked(mode, item))
    assertEquals("| File | Chapters |\n| --- | --- |\n| `24709-fa026c250602.epub` (whole book) | 149 |\n",
      clipboard.primaryClip!!.getItemAt(0).text.toString())
    assertTrue(mode.finished)
  }

  @Test fun selectingLinkedFilenameDoesNotOpenItButShortTapStillDoes() {
    var opened = 0
    withTable(linked = true, onLinkPress = { _, _ -> opened++ }) { _, cells, _ ->
      val cell = cells[2]
      cell.measure(exact(700), exact(100))
      cell.layout(0, 0, 700, 100)
      val x = cell.totalPaddingLeft + cell.layout.getPrimaryHorizontal(1)
      val y = cell.totalPaddingTop + cell.layout.getLineBottom(0) / 2f
      fun touch(action: Int) {
        val now = SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(now, now, action, x, y, 0)
        try { cell.movementMethod.onTouchEvent(cell, cell.text as Spannable, event) } finally { event.recycle() }
      }
      touch(MotionEvent.ACTION_DOWN)
      Selection.setSelection(cell.text as Spannable, 0, "24709-fa026c250602.epub".length)
      touch(MotionEvent.ACTION_UP)
      assertEquals("Releasing a selection must not open the selected link", 0, opened)
      Selection.removeSelection(cell.text as Spannable)
      touch(MotionEvent.ACTION_DOWN)
      touch(MotionEvent.ACTION_UP)
      assertEquals("A short tap must still open the file", 1, opened)
    }
  }

  @Test fun tableSelectionRespectsDisabledSelection() = withTable(selectable = false) { _, cells, _ ->
    cells.forEach { assertFalse(it.isTextSelectable) }
  }

  private fun withTable(
    selectable: Boolean = true,
    linked: Boolean = false,
    onLinkPress: ((String, String) -> Unit)? = null,
    check: (TableContainerView, List<TextView>, ClipboardManager) -> Unit,
  ) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, SelectionTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    try { instrumentation.runOnMainSync {
      val context = activity
      DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(context)
      SoLoader.init(context, OpenSourceMergedSoMapping)
      val inline = JavaOnlyMap.of("fontFamily", "", "fontWeight", "normal", "color", -16777216,
        "backgroundColor", 0, "borderColor", 0, "underline", false, "fontSize", 16.0,
        "fontScale", 0.75, "baselineOffsetScale", 0.2)
      val paragraph = JavaOnlyMap.of("fontSize", 16.0, "fontFamily", "", "color", -16777216,
        "fontWeight", "normal", "lineHeight", 24.0, "marginTop", 0.0, "marginBottom", 0.0)
      val tableStyle = JavaOnlyMap.of("fontSize", 16.0, "fontFamily", "", "fontWeight", "normal",
        "color", -16777216, "lineHeight", 24.0, "marginTop", 0.0, "marginBottom", 0.0,
        "headerTextColor", -16777216, "headerBackgroundColor", 0, "rowEvenBackgroundColor", 0,
        "rowOddBackgroundColor", 0, "borderColor", 0, "borderWidth", 1.0, "borderRadius", 0.0,
        "cellPaddingHorizontal", 8.0, "cellPaddingVertical", 8.0, "horizontalOverflow", 0.0)
      val block = JavaOnlyMap().apply {
        merge(paragraph)
        putInt("backgroundColor", 0)
        putInt("borderColor", 0)
        putInt("bulletColor", -16777216)
        putInt("markerColor", -16777216)
        for (key in listOf("borderWidth", "borderRadius", "padding", "gapWidth", "marginLeft",
          "bulletSize", "markerMinWidth", "itemSpacing", "height", "maxHeight", "aspectRatio")) putDouble(key, 0.0)
      }
      val style = StyleConfig(JavaOnlyMap.of("paragraph", paragraph, "table", tableStyle,
        "codeBlock", block, "blockquote", block, "list", block, "image", block,
        "h1", paragraph, "h2", paragraph, "h3", paragraph, "h4", paragraph, "h5", paragraph, "h6", paragraph,
        "underline", inline,
        "strong", inline, "em", inline, "strikethrough", inline, "link", inline, "code", inline,
        "superscript", inline, "subscript", inline, "highlight", inline,
        "spoiler", JavaOnlyMap.of("color", 0, "particles", JavaOnlyMap.of("density", 1.0, "speed", 1.0),
          "solid", JavaOnlyMap.of("borderRadius", 0.0)),
        "taskList", JavaOnlyMap.of("checkboxSize", 16.0, "checkboxBorderRadius", 2.0, "checkedStrikethrough", false,
          "checkedColor", 0, "borderColor", 0, "checkmarkColor", 0, "checkedTextColor", -16777216)),
        context, true, 0f)
      fun node(type: NodeType, vararg children: MarkdownASTNode) = MarkdownASTNode(type, children = children.toList())
      fun text(value: String) = MarkdownASTNode(NodeType.Text, content = value)
      val filename = node(NodeType.Code, text("24709-fa026c250602.epub"))
      val fileNode = if (linked) MarkdownASTNode(NodeType.Link,
        attributes = mapOf("url" to "file:///tmp/24709-fa026c250602.epub", "recognizedLink" to "true"),
        children = listOf(filename)) else filename
      val ast = node(NodeType.Table,
        node(NodeType.TableHead, node(NodeType.TableRow,
          node(NodeType.TableHeaderCell, text("File")), node(NodeType.TableHeaderCell, text("Chapters")))),
        node(NodeType.TableBody, node(NodeType.TableRow,
          node(NodeType.TableCell, fileNode, text(" (whole book)")),
          node(NodeType.TableCell, text("149")))))
      val config = SegmentViewConfig(context, style, true, 0f, AccessibilityLabels(), SelectionMenuConfig(),
        "simple", selectable, null, null, emptyList(), DynamicBlockProps().apply { enableBlockContextMenu = false },
        onLinkPress, null, null, null)
      val table = SegmentViewCreators.createTableView(RenderedSegment.Table(ast, 1L), config)
      fun cells(view: View): List<TextView> = when (view) {
        is TextView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { cells(view.getChildAt(it)) }
        else -> emptyList()
      }
      activity.setContentView(table)
      check(table, cells(table), context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
    } } finally { instrumentation.runOnMainSync { activity.finish() } }
  }

  private class TestActionMode(private val items: Menu) : ActionMode() {
    var finished = false
    override fun finish() { finished = true }
    override fun invalidate() = Unit
    override fun setTitle(title: CharSequence?) = Unit
    override fun setTitle(resId: Int) = Unit
    override fun setSubtitle(subtitle: CharSequence?) = Unit
    override fun setSubtitle(resId: Int) = Unit
    override fun setCustomView(view: View?) = Unit
    override fun getTitle(): CharSequence = ""
    override fun getSubtitle(): CharSequence = ""
    override fun getCustomView(): View? = null
    override fun getMenu(): Menu = items
    override fun getMenuInflater(): MenuInflater = MenuInflater(InstrumentationRegistry.getInstrumentation().targetContext)
  }

  private class NativeTestReactContext(context: Context) : BridgeReactContext(context), EventDispatcherProvider {
    override fun getEventDispatcher() = BlackHoleEventDispatcher
  }

  private fun withScroll(inverted: Boolean, transform: String = "scale", check: (ReactScrollView, TextView) -> Unit) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    instrumentation.runOnMainSync {
      val appContext = instrumentation.targetContext
      DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(appContext)
      SoLoader.init(appContext, OpenSourceMergedSoMapping)
      val reactContext = NativeTestReactContext(appContext)
      val context = ThemedReactContext(reactContext, appContext)
      val manager = PaseoScrollPackage().createViewManager(reactContext, ReactScrollViewManager.REACT_CLASS) as ReactScrollViewManager
      val scroll = manager.createViewInstance(context)
      val content = FrameLayout(context)
      val text = TextView(context).apply {
        setText("Selectable timeline text", TextView.BufferType.SPANNABLE)
        setTextIsSelectable(true)
      }
      content.addView(text, FrameLayout.LayoutParams(300, 100).apply { topMargin = 1400 })
      scroll.addView(content)
      content.measure(exact(300), exact(2000))
      content.layout(0, 0, 300, 2000)
      scroll.measure(exact(300), exact(300))
      scroll.layout(0, 0, 300, 300)
      // Apply RN's actual Android inversion through the manager's transform decomposition.
      val transforms = JavaOnlyArray.of(JavaOnlyMap.of(transform, if (inverted) -1.0 else 1.0))
      manager.updateProperties(scroll, ReactStylesDiffMap(JavaOnlyMap.of("transform", transforms)))
      if (inverted && transform == "scale") {
        assertEquals(1f, scroll.scaleY, 0f)
        assertEquals(180f, kotlin.math.abs(scroll.rotation), 0f)
      }
      scroll.scrollTo(0, 400)
      check(scroll, text)
    }
  }

  private fun exact(size: Int) = View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY)
}

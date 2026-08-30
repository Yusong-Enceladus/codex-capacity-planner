import SwiftUI

/// One native selection control across Usage & Targets and Calculation & Data.
/// The selected segment supplies its own visual and accessibility state.
struct PlannerSegmentedPicker<Selection: Hashable, Content: View>: View {
    let title: String
    @Binding var selection: Selection
    @ViewBuilder let content: () -> Content

    var body: some View {
        Picker(self.title, selection: self.$selection, content: self.content)
            .pickerStyle(.segmented)
            .labelsHidden()
            .font(.system(size: 13))
            .controlSize(.regular)
            .tint(Color(red: 0.55, green: 0.39, blue: 0.96))
            .accessibilityLabel(self.title)
    }
}

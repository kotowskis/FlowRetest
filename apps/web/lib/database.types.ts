export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      acceptances: {
        Row: {
          accepted_by: string | null
          accepted_by_email: string
          applied_at: string | null
          applied_cases: string[] | null
          applied_note: string | null
          applied_token_id: string | null
          case_ids: string[]
          created_at: string
          id: string
          local_run: string | null
          message: string | null
          run_id: string | null
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          accepted_by?: string | null
          accepted_by_email: string
          applied_at?: string | null
          applied_cases?: string[] | null
          applied_note?: string | null
          applied_token_id?: string | null
          case_ids: string[]
          created_at?: string
          id?: string
          local_run?: string | null
          message?: string | null
          run_id?: string | null
          workflow_id: string
          workspace_id: string
        }
        Update: {
          accepted_by?: string | null
          accepted_by_email?: string
          applied_at?: string | null
          applied_cases?: string[] | null
          applied_note?: string | null
          applied_token_id?: string | null
          case_ids?: string[]
          created_at?: string
          id?: string
          local_run?: string | null
          message?: string | null
          run_id?: string | null
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acceptances_applied_token_id_fkey"
            columns: ["applied_token_id"]
            isOneToOne: false
            referencedRelation: "workspace_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptances_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptances_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      github_checks: {
        Row: {
          check_run_id: number | null
          conclusion: string | null
          created_at: string
          detail: string | null
          html_url: string | null
          id: number
          installation_id: number | null
          ok: boolean
          run_id: string
          workspace_id: string
        }
        Insert: {
          check_run_id?: number | null
          conclusion?: string | null
          created_at?: string
          detail?: string | null
          html_url?: string | null
          id?: never
          installation_id?: number | null
          ok: boolean
          run_id: string
          workspace_id: string
        }
        Update: {
          check_run_id?: number | null
          conclusion?: string | null
          created_at?: string
          detail?: string | null
          html_url?: string | null
          id?: never
          installation_id?: number | null
          ok?: boolean
          run_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations: {
        Row: {
          account_login: string
          account_type: string
          created_at: string
          created_by: string | null
          installation_id: number
          suspended_at: string | null
          workspace_id: string
        }
        Insert: {
          account_login: string
          account_type: string
          created_at?: string
          created_by?: string | null
          installation_id: number
          suspended_at?: string | null
          workspace_id: string
        }
        Update: {
          account_login?: string
          account_type?: string
          created_at?: string
          created_by?: string | null
          installation_id?: number
          suspended_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          organization_id: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          email: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string
          detail: string | null
          id: number
          ok: boolean
          recipient: string
          run_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          detail?: string | null
          id?: never
          ok: boolean
          recipient: string
          run_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          detail?: string | null
          id?: never
          ok?: boolean
          recipient?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_subscriptions: {
        Row: {
          created_at: string
          statuses: string[]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          statuses?: string[]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          statuses?: string[]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          created_at: string
          engine_image: string
          generated_at: string
          git_repository: string | null
          git_sha: string | null
          id: string
          local_run: string | null
          mode: string
          new_label: string
          old_label: string
          pull_request: number | null
          report: Json
          report_bytes: number
          runner: string
          sealed: boolean
          status: string
          summary: Json
          token_id: string | null
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          engine_image: string
          generated_at: string
          git_repository?: string | null
          git_sha?: string | null
          id?: string
          local_run?: string | null
          mode: string
          new_label: string
          old_label: string
          pull_request?: number | null
          report: Json
          report_bytes: number
          runner: string
          sealed: boolean
          status: string
          summary: Json
          token_id?: string | null
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          engine_image?: string
          generated_at?: string
          git_repository?: string | null
          git_sha?: string | null
          id?: string
          local_run?: string | null
          mode?: string
          new_label?: string
          old_label?: string
          pull_request?: number | null
          report?: Json
          report_bytes?: number
          runner?: string
          sealed?: boolean
          status?: string
          summary?: Json
          token_id?: string | null
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "workspace_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          statuses: string[]
          url: string
          url_hint: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          statuses?: string[]
          url: string
          url_hint: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          statuses?: string[]
          url?: string
          url_hint?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          id: string
          last_run_at: string | null
          last_status: string | null
          n8n_workflow_id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          n8n_workflow_id: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          n8n_workflow_id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          engine_tag: string | null
          id: string
          instance_host: string | null
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          engine_tag?: string | null
          id?: string
          instance_host?: string | null
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          engine_tag?: string | null
          id?: string
          instance_host?: string | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_run: {
        Args: { p_case_ids: string[]; p_message: string; p_run_id: string }
        Returns: string
      }
      claim_invitations: { Args: never; Returns: number }
      create_organization: { Args: { p_name: string }; Returns: string }
      ingest_run: {
        Args: {
          p_engine_image: string
          p_generated_at: string
          p_local_run: string
          p_mode: string
          p_n8n_workflow_id: string
          p_new_label: string
          p_old_label: string
          p_report: Json
          p_report_bytes: number
          p_runner: string
          p_sealed: boolean
          p_status: string
          p_summary: Json
          p_token_hash: string
          p_workflow_name: string
        }
        Returns: {
          run_id: string
          workspace_id: string
        }[]
      }
      is_member: { Args: { org: string }; Returns: boolean }
      is_owner: { Args: { org: string }; Returns: boolean }
      mark_acceptance_applied: {
        Args: {
          p_acceptance_id: string
          p_applied_cases: string[]
          p_note: string
          p_token_hash: string
        }
        Returns: boolean
      }
      pending_acceptances: {
        Args: { p_n8n_workflow_id: string; p_token_hash: string }
        Returns: {
          accepted_by_email: string
          case_ids: string[]
          created_at: string
          id: string
          local_run: string
          message: string
        }[]
      }
      run_recipients: {
        Args: { p_run_id: string }
        Returns: {
          email: string
        }[]
      }
      token_workspace: { Args: { p_token_hash: string }; Returns: string }
      workspace_org: { Args: { ws: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


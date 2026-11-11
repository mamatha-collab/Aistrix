export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_blueprints: {
        Row: {
          app_id: string
          blueprint: Json
          blueprint_prod: Json | null
          created_at: string
          readiness_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          blueprint?: Json
          blueprint_prod?: Json | null
          created_at?: string
          readiness_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          blueprint?: Json
          blueprint_prod?: Json | null
          created_at?: string
          readiness_score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_blueprints_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_comparisons: {
        Row: {
          app_id: string
          baseline: Json
          baseline_output: string | null
          candidate: Json
          candidate_output: string | null
          created_at: string
          id: string
          input: string
          user_id: string | null
        }
        Insert: {
          app_id: string
          baseline: Json
          baseline_output?: string | null
          candidate: Json
          candidate_output?: string | null
          created_at?: string
          id?: string
          input: string
          user_id?: string | null
        }
        Update: {
          app_id?: string
          baseline?: Json
          baseline_output?: string | null
          candidate?: Json
          candidate_output?: string | null
          created_at?: string
          id?: string
          input?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_comparisons_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_entitlements: {
        Row: {
          app_id: string
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          run_quota: number | null
          runs_this_period: number
          status: string
          stripe_customer_id: string | null
          stripe_sub_id: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_id: string
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          run_quota?: number | null
          runs_this_period?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          run_quota?: number | null
          runs_this_period?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_entitlements_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_entitlements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_feedback: {
        Row: {
          app_id: string
          comment: string | null
          created_at: string
          id: string
          note: string | null
          rating: number
          run_id: string
          shared_input: string | null
          shared_output: string | null
          status: string
          test_case_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_id: string
          comment?: string | null
          created_at?: string
          id?: string
          note?: string | null
          rating: number
          run_id: string
          shared_input?: string | null
          shared_output?: string | null
          status?: string
          test_case_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          note?: string | null
          rating?: number
          run_id?: string
          shared_input?: string | null
          shared_output?: string | null
          status?: string
          test_case_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_feedback_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "run_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_test_case_id_fkey"
            columns: ["test_case_id"]
            isOneToOne: false
            referencedRelation: "app_test_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      app_files: {
        Row: {
          app_id: string
          bucket: string
          created_at: string
          expires_at: string | null
          file_kind: string
          file_name: string | null
          id: string
          metadata: Json
          mime_type: string | null
          owner_id: string
          run_id: string | null
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          app_id: string
          bucket: string
          created_at?: string
          expires_at?: string | null
          file_kind: string
          file_name?: string | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          owner_id: string
          run_id?: string | null
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          app_id?: string
          bucket?: string
          created_at?: string
          expires_at?: string | null
          file_kind?: string
          file_name?: string | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          owner_id?: string
          run_id?: string | null
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_files_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_knowledge: {
        Row: {
          app_id: string
          content: string
          created_at: string | null
          id: string
          source_url: string | null
          title: string
          type: string | null
        }
        Insert: {
          app_id: string
          content: string
          created_at?: string | null
          id?: string
          source_url?: string | null
          title: string
          type?: string | null
        }
        Update: {
          app_id?: string
          content?: string
          created_at?: string | null
          id?: string
          source_url?: string | null
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_knowledge_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_members: {
        Row: {
          app_id: string
          created_at: string
          id: string
          invited_email: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          user_id?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_members_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_payments: {
        Row: {
          amount: number
          app_id: string
          created_at: string | null
          currency: string | null
          id: string
          run_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          amount: number
          app_id: string
          created_at?: string | null
          currency?: string | null
          id?: string
          run_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          app_id?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          run_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_payments_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_payments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_history"
            referencedColumns: ["id"]
          },
        ]
      }
      app_records: {
        Row: {
          app_id: string
          created_at: string | null
          data: Json
          id: string
          label: string | null
          run_id: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_id: string
          created_at?: string | null
          data: Json
          id?: string
          label?: string | null
          run_id?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string | null
          data?: Json
          id?: string
          label?: string | null
          run_id?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_records_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_reviews: {
        Row: {
          app_id: string
          created_at: string
          id: string
          rating: number
          review_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          rating: number
          review_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          rating?: number
          review_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_reviews_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_run_days: {
        Row: {
          app_id: string
          day: string
          runs: number
        }
        Insert: {
          app_id: string
          day: string
          runs?: number
        }
        Update: {
          app_id?: string
          day?: string
          runs?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_run_days_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_runs: {
        Row: {
          app_id: string
          cost_usd: number | null
          created_at: string
          error_kind: string | null
          event_id: string | null
          id: number
          input_tokens: number | null
          latency_ms: number | null
          live_version: number | null
          model: string | null
          output_tokens: number | null
          source: string
          status: string
          user_id: string | null
        }
        Insert: {
          app_id: string
          cost_usd?: number | null
          created_at?: string
          error_kind?: string | null
          event_id?: string | null
          id?: never
          input_tokens?: number | null
          latency_ms?: number | null
          live_version?: number | null
          model?: string | null
          output_tokens?: number | null
          source: string
          status?: string
          user_id?: string | null
        }
        Update: {
          app_id?: string
          cost_usd?: number | null
          created_at?: string
          error_kind?: string | null
          event_id?: string | null
          id?: never
          input_tokens?: number | null
          latency_ms?: number | null
          live_version?: number | null
          model?: string | null
          output_tokens?: number | null
          source?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_runs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_secrets: {
        Row: {
          app_id: string
          created_at: string | null
          encrypted_value: string
          id: string
          key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string | null
          encrypted_value: string
          id?: string
          key: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string | null
          encrypted_value?: string
          id?: string
          key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_secrets_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_test_cases: {
        Row: {
          app_id: string
          category: string | null
          context: Json
          created_at: string | null
          history: Json
          id: string
          input: string
          name: string
          rules: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          category?: string | null
          context?: Json
          created_at?: string | null
          history?: Json
          id?: string
          input?: string
          name?: string
          rules?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          category?: string | null
          context?: Json
          created_at?: string | null
          history?: Json
          id?: string
          input?: string
          name?: string
          rules?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_test_cases_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_test_runs: {
        Row: {
          app_id: string
          case_ref: string
          category: string | null
          cost_usd: number | null
          created_at: string
          draft_hash: string
          errors: Json
          id: string
          input: string | null
          input_tokens: number | null
          judged_checks: number
          label: string | null
          latency_ms: number | null
          model: string | null
          output: string | null
          output_tokens: number | null
          passed: boolean
          persona: string | null
          source: string
          substantive_checks: number
          user_id: string
        }
        Insert: {
          app_id: string
          case_ref: string
          category?: string | null
          cost_usd?: number | null
          created_at?: string
          draft_hash: string
          errors?: Json
          id?: string
          input?: string | null
          input_tokens?: number | null
          judged_checks?: number
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output?: string | null
          output_tokens?: number | null
          passed: boolean
          persona?: string | null
          source: string
          substantive_checks?: number
          user_id: string
        }
        Update: {
          app_id?: string
          case_ref?: string
          category?: string | null
          cost_usd?: number | null
          created_at?: string
          draft_hash?: string
          errors?: Json
          id?: string
          input?: string | null
          input_tokens?: number | null
          judged_checks?: number
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output?: string | null
          output_tokens?: number | null
          passed?: boolean
          persona?: string | null
          source?: string
          substantive_checks?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_test_runs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_tools: {
        Row: {
          app_id: string
          config: Json
          created_at: string | null
          description: string
          id: string
          input_schema: Json
          name: string
          type: string
        }
        Insert: {
          app_id: string
          config?: Json
          created_at?: string | null
          description: string
          id?: string
          input_schema?: Json
          name: string
          type: string
        }
        Update: {
          app_id?: string
          config?: Json
          created_at?: string | null
          description?: string
          id?: string
          input_schema?: Json
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_tools_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_triggers: {
        Row: {
          app_id: string
          created_at: string
          token: string
        }
        Insert: {
          app_id: string
          created_at?: string
          token: string
        }
        Update: {
          app_id?: string
          created_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_triggers_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_versions: {
        Row: {
          app_id: string
          changelog: string | null
          created_at: string | null
          id: string
          semver: string | null
          tests: Json | null
          user_id: string | null
          version_data: Json
          version_num: number | null
        }
        Insert: {
          app_id: string
          changelog?: string | null
          created_at?: string | null
          id?: string
          semver?: string | null
          tests?: Json | null
          user_id?: string | null
          version_data: Json
          version_num?: number | null
        }
        Update: {
          app_id?: string
          changelog?: string | null
          created_at?: string | null
          id?: string
          semver?: string | null
          tests?: Json | null
          user_id?: string | null
          version_data?: Json
          version_num?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_versions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          app_type: string | null
          billing_mode: string
          change_note: Json | null
          color: string | null
          compose_hint: string | null
          created_at: string | null
          created_by: string | null
          custom_model_name: string | null
          custom_model_url: string | null
          description: string | null
          domain_id: string | null
          embed_allowed_domains: string[]
          embed_public: boolean
          emoji: string | null
          form_schema: Json | null
          free_runs_per_user_day: number | null
          greeting: string | null
          has_draft_changes: boolean | null
          has_memory: boolean | null
          id: string
          input_placeholder: string | null
          is_featured: boolean | null
          is_new: boolean | null
          is_paid: boolean | null
          is_published: boolean | null
          is_top_rated: boolean | null
          is_trending: boolean | null
          is_verified: boolean | null
          live_version: number | null
          max_runs_per_day: number | null
          name: string
          next_app_id: string | null
          output_type: string | null
          pages: Json | null
          pages_public: Json | null
          price_per_run: number | null
          prod_snapshot: Json | null
          promoted_at: string | null
          publish_approved_at: string | null
          required_context: string[] | null
          review_notes: string | null
          sample_input: string | null
          status: string | null
          system_prompt: string | null
          tags: string[] | null
          tone: string | null
          total_runs: number | null
          version: number | null
          visibility: string | null
          webhook_url: string | null
          workflow_order: number | null
          workspace_id: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          app_type?: string | null
          billing_mode?: string
          change_note?: Json | null
          color?: string | null
          compose_hint?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_model_name?: string | null
          custom_model_url?: string | null
          description?: string | null
          domain_id?: string | null
          embed_allowed_domains?: string[]
          embed_public?: boolean
          emoji?: string | null
          form_schema?: Json | null
          free_runs_per_user_day?: number | null
          greeting?: string | null
          has_draft_changes?: boolean | null
          has_memory?: boolean | null
          id?: string
          input_placeholder?: string | null
          is_featured?: boolean | null
          is_new?: boolean | null
          is_paid?: boolean | null
          is_published?: boolean | null
          is_top_rated?: boolean | null
          is_trending?: boolean | null
          is_verified?: boolean | null
          live_version?: number | null
          max_runs_per_day?: number | null
          name: string
          next_app_id?: string | null
          output_type?: string | null
          pages?: Json | null
          pages_public?: Json | null
          price_per_run?: number | null
          prod_snapshot?: Json | null
          promoted_at?: string | null
          publish_approved_at?: string | null
          required_context?: string[] | null
          review_notes?: string | null
          sample_input?: string | null
          status?: string | null
          system_prompt?: string | null
          tags?: string[] | null
          tone?: string | null
          total_runs?: number | null
          version?: number | null
          visibility?: string | null
          webhook_url?: string | null
          workflow_order?: number | null
          workspace_id?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          app_type?: string | null
          billing_mode?: string
          change_note?: Json | null
          color?: string | null
          compose_hint?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_model_name?: string | null
          custom_model_url?: string | null
          description?: string | null
          domain_id?: string | null
          embed_allowed_domains?: string[]
          embed_public?: boolean
          emoji?: string | null
          form_schema?: Json | null
          free_runs_per_user_day?: number | null
          greeting?: string | null
          has_draft_changes?: boolean | null
          has_memory?: boolean | null
          id?: string
          input_placeholder?: string | null
          is_featured?: boolean | null
          is_new?: boolean | null
          is_paid?: boolean | null
          is_published?: boolean | null
          is_top_rated?: boolean | null
          is_trending?: boolean | null
          is_verified?: boolean | null
          live_version?: number | null
          max_runs_per_day?: number | null
          name?: string
          next_app_id?: string | null
          output_type?: string | null
          pages?: Json | null
          pages_public?: Json | null
          price_per_run?: number | null
          prod_snapshot?: Json | null
          promoted_at?: string | null
          publish_approved_at?: string | null
          required_context?: string[] | null
          review_notes?: string | null
          sample_input?: string | null
          status?: string | null
          system_prompt?: string | null
          tags?: string[] | null
          tone?: string | null
          total_runs?: number | null
          version?: number | null
          visibility?: string | null
          webhook_url?: string | null
          workflow_order?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apps_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apps_next_app_id_fkey"
            columns: ["next_app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_job_rows: {
        Row: {
          data: Json | null
          error: string | null
          idx: number
          input: string
          input_tokens: number | null
          job_id: string
          output: string | null
          output_tokens: number | null
          status: string
          updated_at: string
        }
        Insert: {
          data?: Json | null
          error?: string | null
          idx: number
          input: string
          input_tokens?: number | null
          job_id: string
          output?: string | null
          output_tokens?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          data?: Json | null
          error?: string | null
          idx?: number
          input?: string
          input_tokens?: number | null
          job_id?: string
          output?: string | null
          output_tokens?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_job_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "batch_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_jobs: {
        Row: {
          app_id: string
          completed: number
          created_at: string
          failed: number
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          started_at: string | null
          status: string
          stop_reason: string | null
          total: number
          user_id: string
          webhook_url: string | null
          workspace_id: string | null
        }
        Insert: {
          app_id: string
          completed?: number
          created_at?: string
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          total?: number
          user_id: string
          webhook_url?: string | null
          workspace_id?: string | null
        }
        Update: {
          app_id?: string
          completed?: number
          created_at?: string
          failed?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          total?: number
          user_id?: string
          webhook_url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_jobs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprint_test_results: {
        Row: {
          app_id: string
          created_at: string | null
          expected_checks: Json | null
          id: string
          input: string | null
          label: string
          last_errors: Json | null
          last_output: string | null
          last_status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string | null
          expected_checks?: Json | null
          id?: string
          input?: string | null
          label: string
          last_errors?: Json | null
          last_output?: string | null
          last_status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string | null
          expected_checks?: Json | null
          id?: string
          input?: string | null
          label?: string
          last_errors?: Json | null
          last_output?: string | null
          last_status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_test_results_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      code_deployments: {
        Row: {
          app_id: string
          build_id: string
          deployed_at: string
          deployed_by: string
          image: string
          source_id: string
        }
        Insert: {
          app_id: string
          build_id: string
          deployed_at?: string
          deployed_by: string
          image: string
          source_id: string
        }
        Update: {
          app_id?: string
          build_id?: string
          deployed_at?: string
          deployed_by?: string
          image?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_deployments_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_deployments_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "code_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_deployments_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "code_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      code_runtime_reservations: {
        Row: {
          created_at: string
          reserved_seconds: number
          task_id: string
        }
        Insert: {
          created_at?: string
          reserved_seconds: number
          task_id: string
        }
        Update: {
          created_at?: string
          reserved_seconds?: number
          task_id?: string
        }
        Relationships: []
      }
      code_sources: {
        Row: {
          app_id: string
          created_at: string
          files: Json
          id: string
          manifest: Json
          source_hash: string
          studio_contract: boolean
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          files: Json
          id?: string
          manifest: Json
          source_hash: string
          studio_contract?: boolean
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          files?: Json
          id?: string
          manifest?: Json
          source_hash?: string
          studio_contract?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_sources_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      code_studio_drafts: {
        Row: {
          app_id: string
          revision: number
          source_id: string
        }
        Insert: {
          app_id: string
          revision: number
          source_id: string
        }
        Update: {
          app_id?: string
          revision?: number
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_studio_drafts_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_studio_drafts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "code_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      code_studio_revisions: {
        Row: {
          app_id: string
          created_at: string
          revision: number
          source_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          revision: number
          source_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          revision?: number
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_studio_revisions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_studio_revisions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "code_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      code_tasks: {
        Row: {
          app_id: string
          created_at: string
          deadline: string | null
          elapsed_ms: number | null
          error: string | null
          executor: string
          finished_at: string | null
          id: string
          image: string | null
          input: Json | null
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          logs: string
          reserved_seconds: number
          result: Json | null
          source_id: string
          started_at: string | null
          status: string
          user_id: string
          worker_id: string | null
        }
        Insert: {
          app_id: string
          created_at?: string
          deadline?: string | null
          elapsed_ms?: number | null
          error?: string | null
          executor?: string
          finished_at?: string | null
          id?: string
          image?: string | null
          input?: Json | null
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          logs?: string
          reserved_seconds?: number
          result?: Json | null
          source_id: string
          started_at?: string | null
          status?: string
          user_id: string
          worker_id?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string
          deadline?: string | null
          elapsed_ms?: number | null
          error?: string | null
          executor?: string
          finished_at?: string | null
          id?: string
          image?: string | null
          input?: Json | null
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          logs?: string
          reserved_seconds?: number
          result?: Json | null
          source_id?: string
          started_at?: string | null
          status?: string
          user_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_tasks_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_tasks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "code_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      code_workers: {
        Row: {
          executor: string
          id: string
          kind: string
          seen_at: string
        }
        Insert: {
          executor?: string
          id: string
          kind: string
          seen_at?: string
        }
        Update: {
          executor?: string
          id?: string
          kind?: string
          seen_at?: string
        }
        Relationships: []
      }
      conversation_threads: {
        Row: {
          app_id: string
          created_at: string | null
          id: string
          title: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string | null
          id?: string
          title?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string | null
          id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_threads_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_api_keys: {
        Row: {
          app_ids: string[] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string | null
          key_prefix: string | null
          last_used_at: string | null
          name: string
          total_calls: number | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_ids?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          name: string
          total_calls?: number | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_ids?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string | null
          key_prefix?: string | null
          last_used_at?: string | null
          name?: string
          total_calls?: number | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "developer_api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_github: {
        Row: {
          connected_at: string
          login: string | null
          repo: string | null
          token_encrypted: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          login?: string | null
          repo?: string | null
          token_encrypted: string
          user_id: string
        }
        Update: {
          connected_at?: string
          login?: string | null
          repo?: string | null
          token_encrypted?: string
          user_id?: string
        }
        Relationships: []
      }
      developer_limits: {
        Row: {
          analytics: string
          concurrent_tests: number
          draft_apps: number
          published_apps: number
          tests_per_day: number
          tier: string
        }
        Insert: {
          analytics: string
          concurrent_tests: number
          draft_apps: number
          published_apps: number
          tests_per_day: number
          tier: string
        }
        Update: {
          analytics?: string
          concurrent_tests?: number
          draft_apps?: number
          published_apps?: number
          tests_per_day?: number
          tier?: string
        }
        Relationships: []
      }
      developer_notifications: {
        Row: {
          attempts: number
          created_at: string
          id: number
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json | null
          ref: string
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          kind: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload?: Json | null
          ref: string
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload?: Json | null
          ref?: string
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      developer_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          email_alerts: boolean
          github: string | null
          id: string
          is_verified: boolean | null
          stripe_account_id: string | null
          total_earnings: number | null
          twitter: string | null
          updated_at: string
          user_id: string
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          email_alerts?: boolean
          github?: string | null
          id?: string
          is_verified?: boolean | null
          stripe_account_id?: string | null
          total_earnings?: number | null
          twitter?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          email_alerts?: boolean
          github?: string | null
          id?: string
          is_verified?: boolean | null
          stripe_account_id?: string | null
          total_earnings?: number | null
          twitter?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "developer_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_settings: {
        Row: {
          id: string
          settings: Json | null
          user_id: string
        }
        Insert: {
          id?: string
          settings?: Json | null
          user_id: string
        }
        Update: {
          id?: string
          settings?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      developer_test_slots: {
        Row: {
          slot: number
          started_at: string
          user_id: string
        }
        Insert: {
          slot: number
          started_at?: string
          user_id: string
        }
        Update: {
          slot?: number
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      developer_test_usage: {
        Row: {
          day: string
          runs: number
          user_id: string
        }
        Insert: {
          day: string
          runs?: number
          user_id: string
        }
        Update: {
          day?: string
          runs?: number
          user_id?: string
        }
        Relationships: []
      }
      domains: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          id: string
          is_free: boolean | null
          name: string
          order_index: number | null
          slug: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_free?: boolean | null
          name: string
          order_index?: number | null
          slug: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_free?: boolean | null
          name?: string
          order_index?: number | null
          slug?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          app_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_members: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          invited_email: string
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          invited_email: string
          role?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          invited_email?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_members_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_runs: {
        Row: {
          current_step: number
          definition: Json | null
          error: string | null
          finished_at: string | null
          flow_id: string
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          needs_review: boolean
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          seed_input: string | null
          started_at: string
          status: string
          steps: Json
          trigger: string
          user_id: string | null
        }
        Insert: {
          current_step?: number
          definition?: Json | null
          error?: string | null
          finished_at?: string | null
          flow_id: string
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          needs_review?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seed_input?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger: string
          user_id?: string | null
        }
        Update: {
          current_step?: number
          definition?: Json | null
          error?: string | null
          finished_at?: string | null
          flow_id?: string
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          needs_review?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seed_input?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_schedules: {
        Row: {
          created_at: string
          day_of_week: number | null
          enabled: boolean
          flow_id: string
          frequency: string
          hour_utc: number
          id: string
          last_run_at: string | null
          next_run_at: string
          seed_input: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week?: number | null
          enabled?: boolean
          flow_id: string
          frequency?: string
          hour_utc?: number
          id?: string
          last_run_at?: string | null
          next_run_at?: string
          seed_input?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number | null
          enabled?: boolean
          flow_id?: string
          frequency?: string
          hour_utc?: number
          id?: string
          last_run_at?: string | null
          next_run_at?: string
          seed_input?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_schedules_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string | null
          default_provider: string | null
          description: string | null
          emoji: string | null
          gpt_instructions: string | null
          gpt_name: string | null
          gpt_provider: string | null
          id: string
          install_count: number | null
          integration_webhook_url: string | null
          is_published: boolean | null
          kind: string
          memory: Json | null
          memory_provenance: Json | null
          name: string
          privacy: string
          revision: number
          steps: Json
          trigger: Json
          use_knowledge_vault: boolean | null
          user_id: string | null
          webhook_token: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          default_provider?: string | null
          description?: string | null
          emoji?: string | null
          gpt_instructions?: string | null
          gpt_name?: string | null
          gpt_provider?: string | null
          id?: string
          install_count?: number | null
          integration_webhook_url?: string | null
          is_published?: boolean | null
          kind?: string
          memory?: Json | null
          memory_provenance?: Json | null
          name: string
          privacy?: string
          revision?: number
          steps?: Json
          trigger?: Json
          use_knowledge_vault?: boolean | null
          user_id?: string | null
          webhook_token?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          default_provider?: string | null
          description?: string | null
          emoji?: string | null
          gpt_instructions?: string | null
          gpt_name?: string | null
          gpt_provider?: string | null
          id?: string
          install_count?: number | null
          integration_webhook_url?: string | null
          is_published?: boolean | null
          kind?: string
          memory?: Json | null
          memory_provenance?: Json | null
          name?: string
          privacy?: string
          revision?: number
          steps?: Json
          trigger?: Json
          use_knowledge_vault?: boolean | null
          user_id?: string | null
          webhook_token?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_vault: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          source_url: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          source_url?: string | null
          title: string
          type?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          source_url?: string | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_vault_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          app_id: string
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          status: string
          tagline: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string
          tagline?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string
          tagline?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link_view: string | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link_view?: string | null
          message?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link_view?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_environments: {
        Row: {
          history: Json
          owner_id: string
          release_id: string
          resource_key: string
          stage: string
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          history?: Json
          owner_id: string
          release_id: string
          resource_key: string
          stage: string
          updated_at?: string
          updated_by?: string | null
          version: string
        }
        Update: {
          history?: Json
          owner_id?: string
          release_id?: string
          resource_key?: string
          stage?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_environments_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "platform_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_eval_results: {
        Row: {
          cases: Json
          cost_usd: number
          created_at: string
          id: string
          owner_id: string
          pass_rate: number
          passed: boolean
          release_id: string
          required: number
          suite: string
          suite_release_id: string | null
        }
        Insert: {
          cases: Json
          cost_usd?: number
          created_at?: string
          id: string
          owner_id: string
          pass_rate: number
          passed: boolean
          release_id: string
          required: number
          suite: string
          suite_release_id?: string | null
        }
        Update: {
          cases?: Json
          cost_usd?: number
          created_at?: string
          id?: string
          owner_id?: string
          pass_rate?: number
          passed?: boolean
          release_id?: string
          required?: number
          suite?: string
          suite_release_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_eval_results_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "platform_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_eval_results_suite_release_id_fkey"
            columns: ["suite_release_id"]
            isOneToOne: false
            referencedRelation: "platform_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_releases: {
        Row: {
          content_hash: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          owner_id: string
          plans: Json
          resource_key: string
          spec: Json
          surfaces: Json
          version: string
          workspace_id: string | null
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by?: string | null
          id: string
          kind: string
          owner_id: string
          plans?: Json
          resource_key: string
          spec: Json
          surfaces?: Json
          version: string
          workspace_id?: string | null
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          owner_id?: string
          plans?: Json
          resource_key?: string
          spec?: Json
          surfaces?: Json
          version?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      platform_resources: {
        Row: {
          created_at: string
          draft: Json
          draft_hash: string
          key: string
          kind: string
          latest_version: string | null
          name: string
          namespace: string
          owner_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          draft: Json
          draft_hash: string
          key: string
          kind: string
          latest_version?: string | null
          name: string
          namespace: string
          owner_id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          draft?: Json
          draft_hash?: string
          key?: string
          kind?: string
          latest_version?: string | null
          name?: string
          namespace?: string
          owner_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      platform_run_events: {
        Row: {
          created_at: string
          event: Json
          run_id: string
          seq: number
        }
        Insert: {
          created_at?: string
          event: Json
          run_id: string
          seq?: never
        }
        Update: {
          created_at?: string
          event?: Json
          run_id?: string
          seq?: never
        }
        Relationships: [
          {
            foreignKeyName: "platform_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "platform_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_runs: {
        Row: {
          created_at: string
          environment: string | null
          id: string
          lease_expires_at: string
          lease_owner: string | null
          owner_id: string | null
          record: Json
          release_id: string | null
          resource_key: string
          status: string
          trigger: string
          updated_at: string
          version: number
          workload: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          environment?: string | null
          id: string
          lease_expires_at?: string
          lease_owner?: string | null
          owner_id?: string | null
          record: Json
          release_id?: string | null
          resource_key: string
          status: string
          trigger: string
          updated_at?: string
          version?: number
          workload: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          environment?: string | null
          id?: string
          lease_expires_at?: string
          lease_owner?: string | null
          owner_id?: string | null
          record?: Json
          release_id?: string | null
          resource_key?: string
          status?: string
          trigger?: string
          updated_at?: string
          version?: number
          workload?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_runs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "platform_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_secrets: {
        Row: {
          encrypted_value: string
          key: string
          last4: string | null
          owner_id: string
          resource_key: string
          updated_at: string
        }
        Insert: {
          encrypted_value: string
          key: string
          last4?: string | null
          owner_id: string
          resource_key: string
          updated_at?: string
        }
        Update: {
          encrypted_value?: string
          key?: string
          last4?: string | null
          owner_id?: string
          resource_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          app_id: string | null
          buyer_id: string | null
          created_at: string | null
          dev_id: string | null
          dev_share: number
          disputed: boolean
          gross_amount: number
          id: string
          payout_attempts: number
          payout_claimed_at: string | null
          payout_status: string
          plan: string
          platform_fee: number
          refunded_amount: number
          refunded_at: string | null
          stripe_customer_id: string | null
          stripe_payment_ref: string | null
          stripe_sub_id: string | null
          stripe_transfer_id: string | null
          workspace_id: string | null
        }
        Insert: {
          app_id?: string | null
          buyer_id?: string | null
          created_at?: string | null
          dev_id?: string | null
          dev_share?: number
          disputed?: boolean
          gross_amount?: number
          id?: string
          payout_attempts?: number
          payout_claimed_at?: string | null
          payout_status?: string
          plan: string
          platform_fee?: number
          refunded_amount?: number
          refunded_at?: string | null
          stripe_customer_id?: string | null
          stripe_payment_ref?: string | null
          stripe_sub_id?: string | null
          stripe_transfer_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          app_id?: string | null
          buyer_id?: string | null
          created_at?: string | null
          dev_id?: string | null
          dev_share?: number
          disputed?: boolean
          gross_amount?: number
          id?: string
          payout_attempts?: number
          payout_claimed_at?: string | null
          payout_status?: string
          plan?: string
          platform_fee?: number
          refunded_amount?: number
          refunded_at?: string | null
          stripe_customer_id?: string | null
          stripe_payment_ref?: string | null
          stripe_sub_id?: string | null
          stripe_transfer_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      run_events: {
        Row: {
          app_id: string | null
          created_at: string
          id: number
          source: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_id?: string | null
          created_at?: string
          id?: never
          source?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_id?: string | null
          created_at?: string
          id?: never
          source?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      run_history: {
        Row: {
          app_id: string | null
          app_name: string
          created_at: string | null
          feedback_text: string | null
          flow_id: string | null
          flow_name: string | null
          id: string
          input: string
          input_tokens: number | null
          output: string | null
          output_tokens: number | null
          rating_type: string | null
          rating_value: number | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_id?: string | null
          app_name: string
          created_at?: string | null
          feedback_text?: string | null
          flow_id?: string | null
          flow_name?: string | null
          id?: string
          input: string
          input_tokens?: number | null
          output?: string | null
          output_tokens?: number | null
          rating_type?: string | null
          rating_value?: number | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_id?: string | null
          app_name?: string
          created_at?: string | null
          feedback_text?: string | null
          flow_id?: string | null
          flow_name?: string | null
          id?: string
          input?: string
          input_tokens?: number | null
          output?: string | null
          output_tokens?: number | null
          rating_type?: string | null
          rating_value?: number | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_history_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_history_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_events: {
        Row: {
          app_emoji: string | null
          app_id: string
          app_name: string | null
          created_at: string | null
          id: string
          input_template: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          next_run_at: string | null
          schedule_day: number | null
          schedule_time: string
          schedule_type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          app_emoji?: string | null
          app_id: string
          app_name?: string | null
          created_at?: string | null
          id?: string
          input_template: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          schedule_day?: number | null
          schedule_time: string
          schedule_type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          app_emoji?: string | null
          app_id?: string
          app_name?: string | null
          created_at?: string | null
          id?: string
          input_template?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          schedule_day?: number | null
          schedule_time?: string
          schedule_type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      server_once: {
        Row: {
          created_at: string
          key: string
        }
        Insert: {
          created_at?: string
          key: string
        }
        Update: {
          created_at?: string
          key?: string
        }
        Relationships: []
      }
      spend_caps: {
        Row: {
          limit_usd: number
          period: string
          scope: string
          scope_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          limit_usd: number
          period?: string
          scope: string
          scope_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          limit_usd?: number
          period?: string
          scope?: string
          scope_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      spend_reservations: {
        Row: {
          actual_usd: number | null
          app_id: string | null
          created_at: string
          expires_at: string
          id: string
          key_owner: string | null
          model: string | null
          payer: string
          reserved_usd: number | null
          settled_at: string | null
          status: string
          workspace_id: string | null
        }
        Insert: {
          actual_usd?: number | null
          app_id?: string | null
          created_at?: string
          expires_at: string
          id: string
          key_owner?: string | null
          model?: string | null
          payer: string
          reserved_usd?: number | null
          settled_at?: string | null
          status?: string
          workspace_id?: string | null
        }
        Update: {
          actual_usd?: number | null
          app_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          key_owner?: string | null
          model?: string | null
          payer?: string
          reserved_usd?: number | null
          settled_at?: string | null
          status?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      test_deliveries: {
        Row: {
          body: string | null
          content_type: string | null
          created_at: string
          destination: string
          id: string
          method: string
          user_id: string
        }
        Insert: {
          body?: string | null
          content_type?: string | null
          created_at?: string
          destination: string
          id?: string
          method: string
          user_id: string
        }
        Update: {
          body?: string | null
          content_type?: string | null
          created_at?: string
          destination?: string
          id?: string
          method?: string
          user_id?: string
        }
        Relationships: []
      }
      thread_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          rating: number | null
          role: string
          thread_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          rating?: number | null
          role: string
          thread_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          rating?: number | null
          role?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_alerts: {
        Row: {
          condition: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          type: string
          user_id: string
        }
        Insert: {
          condition: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          type: string
          user_id: string
        }
        Update: {
          condition?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          created_at: string | null
          encrypted_key: string
          id: string
          is_active: boolean | null
          label: string | null
          last4: string | null
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          encrypted_key: string
          id?: string
          is_active?: boolean | null
          label?: string | null
          last4?: string | null
          provider: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          encrypted_key?: string
          id?: string
          is_active?: boolean | null
          label?: string | null
          last4?: string | null
          provider?: string
          user_id?: string
        }
        Relationships: []
      }
      user_business_profiles: {
        Row: {
          brand_colors: string | null
          brand_voice: string | null
          company_description: string | null
          company_name: string | null
          contact_info: string | null
          id: string
          industry: string | null
          products: string | null
          target_audience: string | null
          updated_at: string | null
          user_id: string
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_colors?: string | null
          brand_voice?: string | null
          company_description?: string | null
          company_name?: string | null
          contact_info?: string | null
          id?: string
          industry?: string | null
          products?: string | null
          target_audience?: string | null
          updated_at?: string | null
          user_id: string
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_colors?: string | null
          brand_voice?: string | null
          company_description?: string | null
          company_name?: string | null
          contact_info?: string | null
          id?: string
          industry?: string | null
          products?: string | null
          target_audience?: string | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_business_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_career_profiles: {
        Row: {
          bio: string | null
          education: string | null
          experience_years: string | null
          full_name: string | null
          id: string
          job_title: string | null
          linkedin_url: string | null
          location: string | null
          preferred_locations: string | null
          resume_text: string | null
          salary_range: string | null
          skills: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bio?: string | null
          education?: string | null
          experience_years?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          preferred_locations?: string | null
          resume_text?: string | null
          salary_range?: string | null
          skills?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bio?: string | null
          education?: string | null
          experience_years?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          linkedin_url?: string | null
          location?: string | null
          preferred_locations?: string | null
          resume_text?: string | null
          salary_range?: string | null
          skills?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_data_sources: {
        Row: {
          content: string
          created_at: string | null
          id: string
          name: string
          source_url: string | null
          type: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          name: string
          source_url?: string | null
          type?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          name?: string
          source_url?: string | null
          type?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_data_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_goals: {
        Row: {
          app_id: string | null
          app_name: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          period: string
          target_runs: number
          user_id: string
        }
        Insert: {
          app_id?: string | null
          app_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          period: string
          target_runs: number
          user_id: string
        }
        Update: {
          app_id?: string | null
          app_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          period?: string
          target_runs?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_goals_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      user_memory: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          user_id: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          user_id: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          role: string
          user_id: string
        }
        Update: {
          granted_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      visitor_rate_buckets: {
        Row: {
          bucket: string
          hits: string[]
          touched_at: string
        }
        Insert: {
          bucket: string
          hits?: string[]
          touched_at?: string
        }
        Update: {
          bucket?: string
          hits?: string[]
          touched_at?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: string
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          invited_by: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          billing_email: string | null
          created_at: string
          created_by: string | null
          id: string
          is_personal: boolean
          name: string
          personal_owner_id: string | null
          plan: string
          slug: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_personal?: boolean
          name: string
          personal_owner_id?: string | null
          plan?: string
          slug: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_personal?: boolean
          name?: string
          personal_owner_id?: string | null
          plan?: string
          slug?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_developer_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          display_name: string | null
          github: string | null
          twitter: string | null
          user_id: string | null
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          display_name?: string | null
          github?: string | null
          twitter?: string | null
          user_id?: string | null
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          display_name?: string | null
          github?: string | null
          twitter?: string | null
          user_id?: string | null
          website?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_workspace_invite: { Args: { p_token: string }; Returns: string }
      app_feedback_counts: { Args: { p_app_id: string }; Returns: Json }
      app_private_fields: {
        Args: { p_app_ids: string[] }
        Returns: {
          change_note: Json
          custom_model_name: string
          custom_model_url: string
          id: string
          pages: Json
          prod_snapshot: Json
          review_notes: string
          system_prompt: string
          webhook_url: string
        }[]
      }
      app_row_for_editor: { Args: { p_app_id: string }; Returns: Json }
      can_edit_app: { Args: { p_app_id: string }; Returns: boolean }
      claim_app_daily_run: {
        Args: { p_app_id: string; p_limit: number }
        Returns: boolean
      }
      claim_code_task: {
        Args: { p_kind: string; p_worker: string }
        Returns: {
          app_id: string
          created_at: string
          deadline: string | null
          elapsed_ms: number | null
          error: string | null
          executor: string
          finished_at: string | null
          id: string
          image: string | null
          input: Json | null
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          logs: string
          reserved_seconds: number
          result: Json | null
          source_id: string
          started_at: string | null
          status: string
          user_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "code_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_developer_notifications: {
        Args: { p_id?: number }
        Returns: {
          attempts: number
          created_at: string
          id: number
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json | null
          ref: string
          sent_at: string | null
          status: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "developer_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_test_run: { Args: { p_user: string }; Returns: Json }
      config_has_raw_key: { Args: { config: Json }; Returns: boolean }
      consume_entitlement_run: {
        Args: { p_entitlement_id: string }
        Returns: number
      }
      consume_visitor_limit: {
        Args: { p_bucket: string; p_limit: number }
        Returns: boolean
      }
      deploy_code_build: {
        Args: {
          p_app: string
          p_build: string
          p_expected?: string
          p_user: string
        }
        Returns: {
          app_id: string
          build_id: string
          deployed_at: string
          deployed_by: string
          image: string
          source_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "code_deployments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      developer_jobs_schema_status: { Args: never; Returns: Json }
      developer_tier: { Args: { p_user: string }; Returns: string }
      enqueue_code_preview: {
        Args: { p_app: string; p_build: string; p_input: Json; p_user: string }
        Returns: {
          app_id: string
          created_at: string
          deadline: string | null
          elapsed_ms: number | null
          error: string | null
          executor: string
          finished_at: string | null
          id: string
          image: string | null
          input: Json | null
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          logs: string
          reserved_seconds: number
          result: Json | null
          source_id: string
          started_at: string | null
          status: string
          user_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "code_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_code_task: {
        Args: {
          p_app: string
          p_expected_build?: string
          p_input?: Json
          p_kind: string
          p_source: string
          p_user: string
        }
        Returns: {
          app_id: string
          created_at: string
          deadline: string | null
          elapsed_ms: number | null
          error: string | null
          executor: string
          finished_at: string | null
          id: string
          image: string | null
          input: Json | null
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          logs: string
          reserved_seconds: number
          result: Json | null
          source_id: string
          started_at: string | null
          status: string
          user_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "code_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_e2b_task: {
        Args: {
          p_app: string
          p_daily_seconds?: number
          p_expected_build?: string
          p_input?: Json
          p_kind: string
          p_preview_build?: string
          p_source?: string
          p_user: string
        }
        Returns: {
          app_id: string
          created_at: string
          deadline: string | null
          elapsed_ms: number | null
          error: string | null
          executor: string
          finished_at: string | null
          id: string
          image: string | null
          input: Json | null
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          logs: string
          reserved_seconds: number
          result: Json | null
          source_id: string
          started_at: string | null
          status: string
          user_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "code_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ensure_personal_workspace: {
        Args: { p_email?: string; p_name?: string; p_user_id: string }
        Returns: string
      }
      expire_spend_reservations: { Args: never; Returns: number }
      finish_code_task: {
        Args: {
          p_elapsed: number
          p_error: string
          p_id: string
          p_logs: string
          p_result: Json
          p_status: string
          p_token: string
        }
        Returns: boolean
      }
      heartbeat_code_task: {
        Args: { p_id: string; p_token: string }
        Returns: boolean
      }
      heartbeat_flow_run: {
        Args: { p_id: string; p_token: string }
        Returns: boolean
      }
      increment_app_runs: { Args: { p_app_id: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_app_member: {
        Args: { allowed_roles?: string[]; target_app_id: string }
        Returns: boolean
      }
      is_app_owner: { Args: { target_app_id: string }; Returns: boolean }
      is_flow_editor: { Args: { p_flow_id: string }; Returns: boolean }
      is_flow_member: { Args: { p_flow_id: string }; Returns: boolean }
      is_flow_owner: { Args: { target_flow_id: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_workspace_member: {
        Args: { p_roles?: string[]; p_workspace_id: string }
        Returns: boolean
      }
      operations_schema_status: { Args: never; Returns: Json }
      personal_workspace_id: { Args: { p_user_id: string }; Returns: string }
      record_purchase: {
        Args: { p_grant_runs?: number; p_purchase: Json }
        Returns: string
      }
      recover_code_tasks: { Args: { p_app?: string }; Returns: number }
      recover_interrupted_flow_runs: { Args: never; Returns: number }
      release_entitlement_run: {
        Args: { p_entitlement_id: string }
        Returns: number
      }
      release_test_run: {
        Args: { p_slot: number; p_user: string }
        Returns: undefined
      }
      reserve_entitlement_run: {
        Args: { p_entitlement_id: string }
        Returns: number
      }
      reserve_spend: {
        Args: {
          p_amount: number
          p_app: string
          p_hold_seconds?: number
          p_id: string
          p_key_owner: string
          p_model: string
          p_payer: string
          p_platform_limit?: number
          p_platform_period?: string
          p_workspace: string
        }
        Returns: Json
      }
      resolve_flow_invites: { Args: never; Returns: undefined }
      revoke_purchased_run: {
        Args: { p_app_id: string; p_user_id: string }
        Returns: boolean
      }
      save_code_source: {
        Args: {
          p_app: string
          p_files: Json
          p_hash: string
          p_manifest: Json
          p_user: string
        }
        Returns: {
          app_id: string
          created_at: string
          files: Json
          id: string
          manifest: Json
          source_hash: string
          studio_contract: boolean
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "code_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_code_studio_draft: {
        Args: {
          p_app: string
          p_expected: number
          p_files: Json
          p_hash: string
          p_manifest: Json
          p_user: string
        }
        Returns: {
          app_id: string
          revision: number
          source_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "code_studio_drafts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_app_published_with_gate: {
        Args: { p_app_id: string; p_publish: boolean }
        Returns: {
          errors: string[]
          is_published: boolean
          ok: boolean
        }[]
      }
      set_market_listing_status: {
        Args: {
          p_app_id: string
          p_expected_updated_at: string
          p_live: boolean
        }
        Returns: Json
      }
      settle_spend: {
        Args: { p_actual: number; p_id: string; p_outcome: string }
        Returns: boolean
      }
      spend_controls_status: { Args: never; Returns: Json }
      spend_period_start: { Args: { p_period: string }; Returns: string }
      spend_used: {
        Args: { p_scope: string; p_scope_id: string; p_since: string }
        Returns: number
      }
      strip_page_prompts: { Args: { p_pages: Json }; Returns: Json }
      update_app_badges: { Args: never; Returns: undefined }
      update_app_fields: {
        Args: { p_app_id: string; p_expected?: Json; p_patch: Json }
        Returns: Json
      }
      update_code_task_logs: {
        Args: { p_id: string; p_logs: string; p_token: string }
        Returns: boolean
      }
      validate_app_publish_ready: {
        Args: { p_app_id: string }
        Returns: {
          errors: string[]
          ok: boolean
        }[]
      }
      workspace_member_list: {
        Args: { p_workspace_id: string }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          role: string
          user_id: string
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
